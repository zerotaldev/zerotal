// ── FileUploads mixin ─────────────────────────────────────────────────────────
//
// The TypeScript equivalent of Livewire's `WithFileUploads` trait. File uploads work
// like any other input: a `<FileUpload>` / file `<input flow:model>` POSTs the bytes to
// `/__flow/upload` (over HTTP), shows live progress, then `$set`s a signed reference
// that the base Component resolves into a `TemporaryUploadedFile` (signature verified).
// This mixin adds the ergonomic server-side actions for managing those pending uploads —
// chiefly removing a chosen file before it's stored — without bloating the base class.
//
//   class Avatar extends ComponentWith(FileUploads) {
//     @expose photo: TemporaryUploadedFile | null = null;
//     @expose async save() {
//       this.path = await this.photo?.store("avatars"); // persist permanently
//       this.photo = null;
//     }
//     async render() {
//       // <FileUpload bind={this.photo} accept="image/*" />
//       // + a remove button → onClick={() => this.removeUpload("photo")}
//     }
//   }
//
// Multiple files: bind the property to an array and pass `multiple` to <FileUpload>;
// `removeUpload(prop, index)` drops one entry, or all when `index` is omitted.

import { Component } from "../Component.ts";
import { expose } from "../decorators.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AbstractComponentCtor = abstract new (...args: any[]) => Component;

/**
 * Component mixin that adds server-side file-upload management — flow's
 * equivalent of Livewire's `WithFileUploads` trait.
 *
 * @remarks
 * Uploading itself needs no mixin: a `<FileUpload>` / file `<input flow:model>`
 * POSTs bytes to `/__flow/upload` (over HTTP, with live progress) and then
 * `$set`s a signed reference that the base Component resolves into a
 * {@link TemporaryUploadedFile}. This mixin adds the ergonomic action for managing
 * those pending uploads — chiefly {@link WithUploads.removeUpload | removeUpload},
 * for clearing a chosen file before it's stored — without bloating the base class.
 * Bind a single property to accept one file, or an array (with `multiple` on
 * `<FileUpload>`) to accept several.
 *
 * @typeParam TBase - The (abstract) Component constructor being extended.
 * @param Base - The component class to mix into.
 * @returns A subclass of `Base` with upload-management actions.
 *
 * @example
 * ```tsx
 * class Avatar extends ComponentWith(FileUploads) {
 *   @expose photo: TemporaryUploadedFile | null = null;
 *   @expose path = "";
 *
 *   @expose async save() {
 *     this.path = (await this.photo?.store("avatars")) ?? this.path;
 *     this.photo = null;
 *   }
 *
 *   async render() {
 *     return (
 *       <div>
 *         <FileUpload bind={this.photo} accept="image/*" />
 *         <button onClick={() => this.removeUpload("photo")}>Remove</button>
 *         <button onClick={this.save}>Save</button>
 *       </div>
 *     );
 *   }
 * }
 * ```
 */
export function FileUploads<TBase extends AbstractComponentCtor>(Base: TBase) {
  abstract class WithUploads extends Base {
    /**
     * Remove a pending upload (Livewire's `removeUpload`). For a single-file property it
     * clears it (null); for a multiple-file array it removes the item at `index`, or all
     * when `index` is omitted.
     *
     * @param prop - Name of the component property holding the pending upload(s).
     * @param index - For array-valued properties, the item to remove; omit to remove all.
     */
    @expose removeUpload(prop: string, index?: number): void {
      const self = this as unknown as Record<string, unknown>;
      const cur = self[prop];
      if (Array.isArray(cur)) {
        self[prop] =
          index === undefined || index === null ? [] : cur.filter((_, i) => i !== Number(index));
      } else {
        self[prop] = null;
      }
    }
  }
  return WithUploads;
}
