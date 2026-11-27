---
title: Upload Several Files at Once
description: A route that takes any number of files in one form post, stores them with the media library, and a feature test that posts two real files at once.
---

# Upload Several Files at Once

By the end of this recipe, each project in the React starter has an **Attachments** card on
its edit page. Pick several PNG, JPEG or PDF files, upload them in one post, and they are
listed with links that open them. The route checks every file's real type and size before
it stores any of them, the media library keeps the files and the rows that point at them,
and a feature test posts two files at once and asserts that both landed.

## Before you start

The React starter already has everything this builds on:

- the example resource, `Project`: its model, its policy (only the owner may change a
  project) and its edit page at `/projects/:project/edit`;
- `rejectInput()` in `app/support/validation.ts`, which fails a form the way validation
  does, with a message under the field;
- `bootApp()` in `tests/support.ts`, which boots the app against an in-memory database.

The media library and storage ship in the `zerotal` package the app already depends on, as
`zerotal/media` and `zerotal/storage`, and the test helpers as `zerotal/testing`. There is
nothing to install. The starter registers `StorageProvider`, which serves the public disk at
`/storage/public`; it does not register the media library yet.

## Register the media library

Add `MediaProvider` after `StorageProvider` in `bootstrap/providers.ts`. Media writes its
files through the storage disks, so storage comes first.

```ts
// bootstrap/providers.ts
import { StorageProvider } from "zerotal/storage";
import { MediaProvider } from "zerotal/media";
// …

const providers = [
  // …
  StorageProvider,
  MediaProvider,
  // …
];
```

There is no migration to write. `MediaProvider` creates the `media` table when the app
boots, if it is missing. One table holds the files of every model, each row naming the
model and id it belongs to.

## Give projects an attachments collection

A model takes files once it composes the `Media` mixin and declares a collection for them.
In `app/models/Project.ts`, add the import and two constants above the class, then change
what the class extends and declare the collection:

```ts fragment
// app/models/Project.ts
import { Model, column, table } from "zerotal/orm";
import { Media, type MediaCollections } from "zerotal/media";

// …

/** What a project's attachments may be, as the file's own bytes say. */
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "application/pdf"];
/** The largest attachment, in bytes. */
export const MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024;

// …
export class Project extends Model.using(Media) {
  // Mass-assignable from a form. The owner is not on this list: it is set in code,
  // from the signed-in user, so no form field can hand a project to someone else.
  static override fillable = ["name", "description", "status"] as const;

  // The media library refuses anything that does not match, whatever the route checked.
  static override mediaCollections: MediaCollections = {
    attachments: { accepts: ATTACHMENT_TYPES, maxSize: MAX_ATTACHMENT_SIZE },
  };
```

`accepts` is checked against the type read from the file's own bytes, not against its name
or the type the browser declared, since the uploader controls both of those. The route
below makes the same checks first so it can answer with a message on the form; the
collection is the backstop for any other code that adds a file. Exported, the constants are
the one place both read the rules from.

## The upload route

A new file next to the project's other routes. Its `POST` handler answers
`/projects/:project/attachments`:

```ts fragment
// app/routes/(auth)/(verified)/projects/[project]/attachments.ts
import type { HttpContext } from "zerotal";
import { Gate } from "zerotal/auth";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_SIZE, type Project } from "@app/models/Project";
import { rejectInput } from "@app/support/validation";

/** The most files one post may carry. */
const MAX_FILES = 10;

// POST /projects/:project/attachments — any number of files under one field, `attachments`.
export async function POST(http: HttpContext<{ project: Project }>): Promise<void> {
  const project = http.params.project;
  Gate.authorize("update", project);
  const back = `/projects/${project.id}/edit`;

  // Every file posted under the field, in the order sent, whether the client named the
  // parts `attachments`, `attachments[]` or `attachments[0]`, `attachments[1]`, ….
  const files = await http.files("attachments");
  if (files.length === 0) {
    rejectInput(http, { attachments: "Choose at least one file." }, back);
  }
  if (files.length > MAX_FILES) {
    rejectInput(http, { attachments: `Attach at most ${MAX_FILES} files at a time.` }, back);
  }

  // Check them all before storing any, so one bad file does not leave half a batch behind.
  // The type is read from the bytes: the name and the declared type are the client's say-so.
  for (const file of files) {
    const { contentType } = await file.detectType();
    if (!ATTACHMENT_TYPES.includes(contentType) || file.size > MAX_ATTACHMENT_SIZE) {
      rejectInput(
        http,
        { attachments: `“${file.originalName}” is not a PNG, JPEG or PDF of 2 MB or less.` },
        back,
      );
    }
  }

  for (const file of files) {
    await project.addMedia(file).toCollection("attachments");
  }

  http.flash(
    "success",
    files.length === 1 ? "1 file was attached." : `${files.length} files were attached.`,
  );
  http.redirect(back, 303);
}
```

What each part is for:

- **`http.files("attachments")`** returns every file posted under that field, in the order
  they were sent. A browser's own multiple-file input repeats the name `attachments`, and
  the Inertia form helper sends `attachments[]`; `files()` reads both, and
  `attachments[0]`, `attachments[1]`, … as well.
- **The checks run in the route.** `validate()` and a `FormRequest` see one value per field
  name, so a list of files under one name is not something their rules can check. The
  route checks the list itself and fails the form with `rejectInput()`, which leaves the
  message where `form.errors.attachments` reads it.
- **Every file is checked before any is stored.** Left to the collection, a bad second file
  is refused with an error response after the first is already stored, and the form shows
  no message.
- **`detectType()`** sniffs the type from the leading bytes, as the media library does, so
  a script renamed `photo.png` is refused here rather than at the collection.
- **`addMedia(file).toCollection("attachments")`** stores the bytes on the public disk under
  `media/<uuid>/` and writes the row. The item is named after the uploaded file, without its
  extension.

Each file may be 2 MB, but the post as a whole is still held to the app's request body
limit, 8 MiB unless `app.maxRequestBodySize` says otherwise. A larger post is answered with
`413` before the route runs; [Request body size](/docs/routing#request-body-size) explains
the limit.

The policy check comes first: `Gate.authorize("update", project)` turns anyone but the
owner away with a `403` before the upload is read.

## Show the files on the edit page

The edit page needs the project's attachments. In the `GET` handler of
`app/routes/(auth)/(verified)/projects/[project]/edit.ts`, read them and pass them as plain
JSON:

```ts fragment
// app/routes/(auth)/(verified)/projects/[project]/edit.ts
// …
export const GET = async (http: HttpContext<{ project: Project }>) => {
  const project = http.params.project;
  Gate.authorize("update", project);
  const attachments = await project.getMedia("attachments");

  return Inertia.render("projects/edit", {
    title: `Edit ${project.name}`,
    project: project.toPage(),
    // Plain JSON for the page: a name to show and a link that opens the file.
    attachments: attachments.map((media) => ({
      id: media.id,
      name: media.name,
      url: media.getUrl(),
    })),
  });
};
```

`media.getUrl()` is `/storage/public/media/<uuid>/original.pdf`, a link that works as soon
as the file is stored, because `StorageProvider` serves the public disk.

Describe the new prop to the page in `resources/js/types.ts`, after `Project`:

```ts
// resources/js/types.ts
// …
/** A file attached to a project, as the edit page receives it. */
export interface Attachment {
  id: number;
  name: string;
  url: string;
}
```

The card lists the files and holds the picker:

```tsx fragment
// resources/js/Components/ProjectAttachments.tsx
import type { FormEvent } from "react";
import { useForm } from "@inertiajs/react";
import { Button } from "./Button";
import { Card, CardBody, CardFooter, CardHeader } from "./Card";
import type { Attachment } from "../types";

/** A project's files, and a picker that uploads several at once. */
export function ProjectAttachments({
  projectId,
  attachments,
}: {
  projectId: number;
  attachments: Attachment[];
}) {
  const form = useForm<{ attachments: File[] }>({ attachments: [] });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget;
    // A File in the data makes the helper send multipart, one part per file.
    form.post(route("projects.attachments.store", { project: projectId }), {
      onSuccess: () => {
        form.reset();
        input.reset();
      },
    });
  }

  return (
    <Card>
      <CardHeader title="Attachments" description="PNG, JPEG or PDF, up to 2 MB each." />
      <form onSubmit={submit}>
        <CardBody className="space-y-4">
          {attachments.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {attachments.map((file) => (
                <li key={file.id}>
                  <a href={file.url} className="text-primary hover:underline">
                    {file.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No files yet.</p>
          )}
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,application/pdf"
            aria-label="Files to attach"
            onChange={(e) => form.setData("attachments", Array.from(e.target.files ?? []))}
            className="block text-sm"
          />
          {form.errors.attachments ? (
            <p className="text-sm text-destructive">{form.errors.attachments}</p>
          ) : null}
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={form.processing || form.data.attachments.length === 0}>
            {form.processing ? "Uploading…" : "Upload"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
```

`multiple` on the input is what lets someone choose several files in one go. The form
helper sees `File` objects in its data and sends the post as `multipart/form-data`, one part
per file.

Put the card under the project form:

```tsx fragment
// resources/js/pages/projects/edit.tsx
import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppLayout from "../../Layouts/AppLayout";
import { PageHeader } from "../../Components/PageHeader";
import { ProjectAttachments } from "../../Components/ProjectAttachments";
import { ProjectForm } from "../../Components/ProjectForm";
import type { Attachment, Project } from "../../types";

interface Props {
  title: string;
  project: Project;
  attachments: Attachment[];
}

function EditProject({ title, project, attachments }: Props) {
  return (
    <>
      <Head title={title} />
      <div className="max-w-2xl space-y-6">
        <PageHeader title={project.name} back={{ href: route("projects"), label: "Projects" }} />
        <ProjectForm project={project} />
        <ProjectAttachments projectId={project.id} attachments={attachments} />
      </div>
    </>
  );
}

EditProject.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default EditProject;
```

The starter's `tests/pages.test.ts` renders every page with the props its route sends, so
give the edit page its new one there too:

```ts fragment
// tests/pages.test.ts
const SIGNED_IN: PageCase[] = [
  // …
  ["projects/edit", EditProject, { title: "Edit", project: PROJECT, attachments: [] }],
  // …
];
```

Then regenerate the typed route names, so `route("projects.attachments.store", …)` in the
card type-checks:

```bash
# in your project root
bun zt route:types
```

## Keep uploads out of git

Files uploaded in development land in `storage/public/media/`. They belong to the
environment that received them, like the database, so keep them out of version control:

```gitignore
# .gitignore
# …
# Files people upload. They belong to the environment that received them, like the database.
storage/public/media/
```

## The test

```ts fragment
// tests/project-attachments.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MediaFake } from "zerotal/media";
import { Storage } from "zerotal/storage";
import { fakeFile, refreshDatabase, type TestApp } from "zerotal/testing";
import { inertiaProps } from "@zerotal/inertia/testing";
import { ProjectFactory } from "../database/factories/ProjectFactory";
import { UserFactory } from "../database/factories/UserFactory";
import { bootApp } from "./support";

let app: TestApp;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());
// Put the real disks back, or the next file's uploads land in a fake.
afterEach(() => Storage.restoreFakes());

describe("project attachments", () => {
  refreshDatabase();

  test("attaches several files in one post", async () => {
    // The disk media writes to when none is configured.
    const disk = Storage.fake("public");
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create();

    // `multipart()` takes one value per name, so the parts are numbered. `files()` reads
    // `attachments[0]`, `attachments[1]` as one list, just as it reads `attachments[]`.
    const res = await app.actingAs(user).multipart(`/projects/${project.id}/attachments`, {
      "attachments[0]": fakeFile.image("sketch.png", { width: 64, height: 48 }),
      "attachments[1]": fakeFile.pdf("brief.pdf"),
    });

    res.assertRedirect(`/projects/${project.id}/edit`);
    await MediaFake.assertCount(project, "attachments", 2);
    disk.assertCount(2);
    disk.assertExistsMatching(/^media\/[0-9a-f-]+\/original\.png$/);
    disk.assertExistsMatching(/^media\/[0-9a-f-]+\/original\.pdf$/);

    // In the order they were sent, named after the uploaded file.
    const [sketch, brief] = await project.getMedia("attachments");
    expect(sketch?.name).toBe("sketch");
    expect(sketch?.mimeType).toBe("image/png");
    expect(brief?.name).toBe("brief");
    expect(brief?.mimeType).toBe("application/pdf");
  });

  test("lists the attachments on the edit page", async () => {
    Storage.fake("public");
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create();
    await project.addMedia(fakeFile.pdf("brief.pdf")).toCollection("attachments");

    const res = (await app.actingAs(user).get(`/projects/${project.id}/edit`)).assertOk();
    const { attachments } = inertiaProps(res, "projects/edit");

    expect(attachments.map((file) => file.name)).toEqual(["brief"]);
  });

  test("refuses the whole batch when one file is not allowed", async () => {
    const disk = Storage.fake("public");
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create();

    // A script named and declared as a PNG. Its bytes give it away.
    const res = await app.actingAs(user).multipart(`/projects/${project.id}/attachments`, {
      "attachments[0]": fakeFile.image("fine.png"),
      "attachments[1]": fakeFile.create("photo.png", "<script>alert(1)</script>", "image/png"),
    });

    res.assertRedirect(`/projects/${project.id}/edit`);
    res.assertInvalid(["attachments"]);
    await MediaFake.assertMissing(project, "attachments");
    disk.assertNothingStored();
  });

  test("refuses a file over the size limit", async () => {
    const disk = Storage.fake("public");
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create();

    // A real PDF signature, padded to 3 MB, so it is refused for its size and not its type.
    const bytes = new Uint8Array(3 * 1024 * 1024);
    bytes.set(new TextEncoder().encode("%PDF-1.4\n"));

    const res = await app.actingAs(user).multipart(`/projects/${project.id}/attachments`, {
      "attachments[0]": fakeFile.create("huge.pdf", bytes, "application/pdf"),
    });

    res.assertInvalid(["attachments"]);
    disk.assertNothingStored();
  });

  test("deletes the files with the project", async () => {
    const disk = Storage.fake("public");
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create();
    await app.actingAs(user).multipart(`/projects/${project.id}/attachments`, {
      "attachments[0]": fakeFile.pdf("brief.pdf"),
    });
    disk.assertCount(1);

    await app.actingAs(user).delete(`/projects/${project.id}`);

    await MediaFake.assertMissing(project, "attachments");
    disk.assertNothingStored();
  });

  test("forbids attaching files to someone else’s project", async () => {
    const disk = Storage.fake("public");
    const owner = await UserFactory.create();
    const stranger = await UserFactory.create();
    const project = await ProjectFactory.for(owner).create();

    (
      await app.actingAs(stranger).multipart(`/projects/${project.id}/attachments`, {
        "attachments[0]": fakeFile.pdf("brief.pdf"),
      })
    ).assertForbidden();

    await MediaFake.assertMissing(project, "attachments");
    disk.assertNothingStored();
  });
});
```

What each part relies on:

- **`Storage.fake("public")`** swaps the public disk for one held in memory, and returns it
  for assertions. It has to be `public`: with no disk configured, that is where media
  writes. `Storage.fake()` with no name replaces the default `local` disk, which media does
  not use, and the files would land on the real disk.
- **`Storage.restoreFakes()`** after each test puts the real disks back. All the test files
  in a run share one booted app, so a fake left behind is still in place for the next file.
- **`fakeFile`** builds real files: `fakeFile.image()` is a valid PNG and `fakeFile.pdf()`
  a valid PDF, so the type sniffing sees what a browser would send. The size test pads a
  real PDF signature, so it is refused for its size and not its type.
- **`multipart()`** sends the form as `multipart/form-data`. Its fields are an object, one
  value per name, which is why the parts are numbered.
- **`MediaFake`** asserts on the rows and **the fake disk** on the bytes. A row with no file
  and a file with no row are different bugs, and each assertion catches one of them.

## Run it

```bash
# in your project root
bun zt test tests/project-attachments.test.ts
```

```
…
 0 fail
```

Then run the whole suite with `bun zt test`, which includes the page test you updated.

To try it in the browser, run `bun zt dev`, sign in as `demo@example.com` with the password
`password` (after `bun zt db:seed`), and open a project's edit page. Choose two files and
upload them: both are listed, and each link opens the file. Choose a text file renamed to
`.png` and the card shows the message from the route instead.

## See also

- [Media Library](/docs/media) — collections, conversions, ordering, and private files with
  signed links.
- [Which disk, and how files are served](/docs/media#which-disk-and-how-files-are-served) —
  why media lands on the public disk, and how to choose another.
- [Requests Context](/docs/context#uploaded-files) — `file()`, `files()` and
  `UploadedFile`.
- [Storage](/docs/storage#serving-files-over-http) — the disks, and which of them are
  served.
- [HTTP Tests](/docs/testing/http#file-uploads) — `multipart()` and every `fakeFile`
  builder.
- [Routing](/docs/routing#request-body-size) — the request body limit.
