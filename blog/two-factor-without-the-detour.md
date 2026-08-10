---
title: "Two-Factor, Start to Finish, Without Leaving Your Server"
description: "Zerotal 1.4.0 draws the enrolment QR code in your own process — TOTP secrets, recovery codes and the scannable image, all without a request leaving the box. The whole setup page is about fifteen lines."
date: 2026-08-10
category: Announcements
order: 2
---

# Two-Factor, Start to Finish, Without Leaving Your Server

Two-factor authentication is one of those features that looks like an afternoon and turns into a fortnight. The maths is a solved problem — RFC 6238, six digits, thirty-second window — and Zerotal has had that side covered for a while: `TwoFactor.generateSecret()`, `verifyCode()`, single-use recovery codes stored as hashes, replay protection, a middleware that gates routes until the challenge is answered.

What was missing was the last mile. You have an `otpauth://` URI. The user has a phone. Between those two things sits a picture of some squares, and drawing it is not an authentication problem — it is a graphics problem, which is why it tends to get outsourced to whatever renders a QR code fastest.

In 1.4.0 it stops being your problem, and stops being anyone else's:

```tsx
const qr = TwoFactor.getQrCodeSvg(user.email, secret, { size: 220 });

return <div dangerouslySetInnerHTML={{ __html: qr }} />;
```

Inline SVG, generated in your process. No request goes out, so the payload — which carries the TOTP secret — never becomes a URL that could be logged by a proxy, cached by a browser, or held by a third party. For anything under POPIA, GDPR, PCI or an internal security review, "the second factor never leaves the process" is a much shorter conversation than the alternative.

## The whole setup page

Enrolment is deliberately two steps, and the reason is worth a sentence: a user who scans the code and then closes the laptop must not end up locked out by a half-finished setup. So the secret is stored unconfirmed, and only a working code confirms it.

```tsx
// 1. Start enrolment
const secret = TwoFactor.generateSecret();
const qr = TwoFactor.getQrCodeSvg(user.email, secret, { size: 220 });
const uri = TwoFactor.getQrCodeUrl(user.email, secret);
const { plain, hashed } = TwoFactor.generateRecoveryCodes();

// 2. Confirm — nothing is switched on until a real code passes
if (!TwoFactor.verifyCode(secret, code)) {
  return this.back().withErrors({ code: "That code didn't work." });
}
```

Three things belong on that page, and the third is the one people leave out:

- **The QR code**, for the common case.
- **The `otpauth://` URI as a link** — on a phone, tapping it opens the authenticator directly.
- **The secret as text**, in readable blocks. A phone cannot photograph its own screen, so anyone enrolling on the device that holds their authenticator needs to type it. This is the second-most-common way people set up 2FA and the most commonly forgotten.

`getQrCodeSvg()` takes the issuer override, colours (`light: null` for a transparent background), pixel size, quiet zone, an accessible name and a CSS class. If you would rather draw it yourself — to a canvas, a PNG, your own markup — `encodeQr()` hands back the module matrix and `qrSvg()` renders one.

## Sized for the job, and honest about it

The encoder is deliberately narrow: byte mode, error-correction level M, versions 1 through 20 — up to 666 bytes, against a typical `otpauth://` URI of about 130. Numeric and kanji modes would encode an ASCII URI no better and are simply absent. It is a component sized for one payload rather than a general-purpose imaging library, which is what makes it a reasonable thing for a framework to carry.

The range is generous on purpose. The issuer appears **twice** in an `otpauth://` URI — once inside the label, once as its own parameter — and both copies are percent-encoded. A company called `Acme Financial Services (Pty) Ltd` spends thirty characters on spaces and brackets before anyone's email address is counted, and a long departmental address on top of that clears 240 bytes without trying. Those are exactly the organisations most likely to mandate two-factor in the first place.

Past the ceiling you get a `QrError` naming the fix — shorten the issuer or the label — rather than a truncated symbol that looks like a QR code and scans as nothing.

## Verifying a picture

One note for anyone who has written one of these, because it is the interesting engineering constraint: a QR symbol is not human-readable, so looking at it proves nothing. A wrong matrix and a right matrix are both a picture of squares.

So the encoder is tested by reading it back — a second, independently written decoder that rebuilds the function-module map, undoes the mask, walks the placement zigzag, de-interleaves the blocks and compares the bytes to what went in, at every version the encoder supports. It also evaluates each block's Reed-Solomon polynomial and asserts the syndromes are zero, because error correction is the one part that a clean round-trip cannot exercise: parity bytes can be silently useless while the data reads back perfectly.

Where a constant had to come from ISO/IEC 18004, it is written in a different shape on the test side — block counts rather than group tuples, alignment centres derived from the placement rule rather than listed — so a typo on one side cannot agree with a typo on the other.

---

In `@zerotal/auth` from 1.4.0, alongside [encrypted columns](/blog/encrypted-columns) in the ORM. Full reference in [Roles & 2FA](/docs/roles-and-2fa).
