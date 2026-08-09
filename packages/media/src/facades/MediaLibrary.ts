import { createFacade } from "@zerotal/core";

/**
 * Facade over the container's `media` binding.
 *
 * Named `MediaLibrary` rather than `Media` because {@link Media} is the model
 * mixin, and an app importing both would otherwise have to rename one at every
 * call site. The facade is the rarer of the two.
 *
 * @example
 * import { MediaLibrary } from "@zerotal/media";
 *
 * await MediaLibrary.regenerate(media, Product, ["thumb"]);
 * const report = await MediaLibrary.clean({ dryRun: false });
 */
export const MediaLibrary = createFacade("media");
