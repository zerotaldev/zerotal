import { registerSynth } from "./index.ts";
import { TemporaryUploadedFile, type TufData } from "../uploads/TemporaryUploadedFile.ts";

// Synth (key "tuf") that lets a TemporaryUploadedFile property round-trip through
// the (HMAC-signed) snapshot: dehydrates to its plain TufData ref and hydrates via
// fromTrustedRef (no per-ref signature check, since the whole snapshot is signed).
// Registered as a side effect of importing this module.
registerSynth({
  key: "tuf",
  match(value): value is TemporaryUploadedFile {
    return value instanceof TemporaryUploadedFile;
  },
  dehydrate(value: TemporaryUploadedFile) {
    return value.toRef();
  },
  hydrate(data) {
    return TemporaryUploadedFile.fromTrustedRef(data as TufData);
  },
});
