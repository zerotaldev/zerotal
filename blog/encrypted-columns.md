---
title: "The Column That Keeps Its Mouth Shut"
description: "Zerotal 1.4.0 encrypts a column at rest in one word — ciphertext in the database, plaintext on the model, nothing in between that has to know. The interesting part is the three things it refuses to do."
date: 2026-08-10
category: Announcements
order: 1
---

# The Column That Keeps Its Mouth Shut

Somewhere in the middle of building a real application, a lawyer asks a question. Usually it is some version of: _if that database is copied, what does the person holding it learn?_

For most columns the answer is fine. A booking reference is a booking reference. But then there is `id_number`, and `passport_number`, and the free-text medical note somebody added to the customer record, and suddenly the answer is "everything, immediately, about several thousand people". POPIA calls those special personal information. GDPR has its own words for it. Both arrive at the same instruction: that column should not be readable at rest.

So you write the cast. Everyone writes the cast. It is about twelve lines, it is the same twelve lines in every codebase that needs it, and it is entirely uninteresting to write:

```ts
export class EncryptedCast extends Cast<string | undefined> {
  get(dbValue: unknown) {
    return Crypt.decryptString(String(dbValue));
  }
  set(value: string | undefined) {
    return value ? Crypt.encryptString(value) : null;
  }
}
```

Two methods, and encryption at rest is done. It is a good seam — which is exactly why it should be one word instead.

## The whole feature

```ts
class Client extends Model {
  @column("encrypted", { nullable: true }) idNumber?: string;
  @column("encrypted:json") medical?: MedicalInfo;
}
```

Or, when it is several columns and you would rather say it once:

```ts
class Client extends Model {
  static encryptable = ["idNumber", "passportNumber"];
}
```

The two mean the same thing — the list resolves to the same cast, so the read path, the write path, `$dirty` and the query guard all see one mechanism rather than two that must be kept in agreement. AES-256-GCM, keyed by your `APP_KEY`, through the `Crypt` facade that was already in the box.

The column holds ciphertext. The property holds what you assigned. Nothing between them — your validation, your Flow page, your tests — has to know.

## Three things it will not do

The encryption is the easy half. The decisions worth writing down are the refusals.

### It will not overwrite your model

Zerotal already has `static hashable` for passwords, and it works by replacing the property in place: after `save()`, `user.password` is the bcrypt hash. That is correct for a one-way hash. There is nothing else it could be.

Encryption is reversible, so doing the same would be a pure loss. You would call `save()` and your own object would quietly become unreadable — every line of code after that point reading ciphertext where it expects an ID number.

So encryption happens on the way to the database, not to the instance:

```ts
client.idNumber = "8001015009087";
await client.save();
client.idNumber; // → "8001015009087"
```

There is a second benefit that only shows up months later. Because the model holds plaintext, `$dirty` compares plaintext — so a save that changes the customer's _name_ does not rewrite the encrypted column. Had it compared ciphertext, every write would produce a fresh IV and every save would look like a change, churning a column that nobody touched and lighting up anything watching the table for changes.

### It will not let you query it

This is the one that surprises people, so it fails loudly:

```ts
await Client.query().where("idNumber", "8001015009087");
// EncryptedColumnError: Cannot filter on Client.idNumber — it is an encrypted
// column. Every write draws a fresh IV, so the same value encrypts to different
// ciphertext each time and an equality match can never hit. Keep a separate
// hashed lookup column (a blind index) beside it and query that instead.
```

The fresh IV per write is not an accident to be optimised away — it is the reason two clients sharing an ID number do not have identical bytes in the column. Deterministic encryption would make the column searchable and would also leak equality across every row, which for an identity number is most of what you were hiding.

What made this worth a hard error rather than a note in the docs is what the alternative looks like. The bind path runs a column's cast over the value you are searching for. Encrypt the search term under a new IV, compare it to ciphertext written under a different one, and you get zero rows — no exception, no warning, just an empty result. A screen that reads "no such client" for a client who is sitting right there is not a bug anyone finds quickly.

### It will not hand back the ciphertext

There is a tempting shortcut when a value fails to decrypt: return it as-is and carry on. It reads as robustness — the app keeps working, nothing crashes.

It is the one behaviour that can actually lose the data. A value the key cannot open is now indistinguishable, to every line of code downstream, from a real ID number. It renders into a form. It goes into the CSV export. And if that form round-trips — user opens the record, changes their phone number, saves — the ciphertext is encrypted a second time and the original is gone for good.

So a value that will not decrypt fails the read, and says which of the two things happened:

```text
Could not decrypt Client.idNumber. The column is cast "encrypted", so what is
stored has to be ciphertext this APP_KEY can open. Two things cause this: APP_KEY
changed since the row was written (decrypt with the old key and re-save), or the
column already held plaintext when the cast was added (back-fill the existing
rows before switching it on). The row cannot be read until one of those is
resolved.
```

Turning encryption on for a column that already holds data therefore needs a back-fill first. That is a real cost, and it is deliberate: it is one migration you run once, instead of a class of corruption you discover a year later.

## The small print that is actually load-bearing

**Declare it `text`.** A GCM payload is roughly 1.4× its plaintext plus 28 bytes of IV and auth tag, base64'd. A `VARCHAR(255)` that comfortably held the value will not hold its ciphertext — and MySQL outside strict mode truncates rather than failing, which destroys the row at write time and says nothing. `migrate:generate` and `synchronize()` now widen an encrypted column to TEXT whatever you declared, and the generated migration says `table.text(...)` so it is visible in review rather than hidden in a framework.

**`encrypted` is a cast, not a storage type.** `@column("encrypted")` is the shorthand, and it resolves to `{ type: "text", cast: "encrypted" }` — which is exactly why the shorthand is worth preferring over spelling it out: it gets the storage type right without you having to know any of the previous paragraph.

**Structured values need `encrypted:json`.** Plain `encrypted` stores strings, and refuses anything else rather than quietly storing `String(value)` — because `"[object Object]"` encrypts and decrypts perfectly and is nonsense. A column listed in `static encryptable` that is declared `json` picks the JSON variant on its own, since the list form has nowhere to say so.

**Add them to `hidden`.** Decryption puts the real value back on the instance, and `toJSON()` will happily include it.

---

In `@zerotal/orm` from 1.4.0. Full reference in [Casts & Mutators](/docs/orm/casts) — and the same release keeps another secret on your own server, with [two-factor QR codes rendered in-process](/blog/two-factor-without-the-detour).
