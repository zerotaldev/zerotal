/**
 * One suite, run against every shipped {@link ImageDriver}.
 *
 * `media.driver` is a single config line, and apps flip it expecting the same
 * pictures out. That only holds if the drivers agree on the awkward cases —
 * clamped enlargement, rotation order, half-pixel centring — so those are
 * pinned here rather than left to whichever backend happens to be installed.
 *
 * The sharp half self-skips when sharp is absent; it is an optional peer. CI
 * installs it (a devDependency of this package) so parity is actually enforced
 * rather than quietly skipped.
 */
import { describe, expect, test } from "bun:test";
import { BunImageDriver } from "./BunImageDriver.ts";
import { SharpImageDriver } from "./SharpImageDriver.ts";
import { decodePng, encodePng, type RasterImage } from "./raster.ts";
import type { ImageDriver } from "./ImageDriver.ts";

const sharpInstalled = await (async () => {
  try {
    const specifier = "sharp";
    await import(specifier);
    return true;
  } catch {
    return false;
  }
})();

const drivers: Array<[string, () => ImageDriver]> = [
  ["BunImageDriver", () => new BunImageDriver()],
  ...(sharpInstalled
    ? ([["SharpImageDriver", () => new SharpImageDriver()]] as Array<[string, () => ImageDriver]>)
    : []),
];

/** A gradient source — flat colour would hide resampling differences. */
function source(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      rgba[at] = Math.round((x / Math.max(1, width - 1)) * 255);
      rgba[at + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      rgba[at + 2] = 0x80;
      rgba[at + 3] = 0xff;
    }
  }
  return encodePng({ width, height, rgba });
}

/** Four solid quadrants, so a mis-centred crop is visible in the corners. */
function quadrants(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      rgba[at] = x < width / 2 ? 255 : 0;
      rgba[at + 1] = y < height / 2 ? 255 : 0;
      rgba[at + 2] = 0;
      rgba[at + 3] = 255;
    }
  }
  return encodePng({ width, height, rgba });
}

async function decodeResult(bytes: Uint8Array): Promise<RasterImage> {
  return decodePng(await new Bun.Image(bytes).png().bytes());
}

describe.each(drivers)("%s", (name, make) => {
  const driver = make();

  test("reports that it can crop", () => {
    expect(driver.supportsCrop).toBe(true);
  });

  describe("fit: cover — output dimensions", () => {
    // Expectations are sharp 0.34's actual behaviour, measured, not inferred.
    const cases: Array<{
      label: string;
      source: [number, number];
      target: [number, number];
      withoutEnlargement?: boolean;
      expected: [number, number];
    }> = [
      {
        label: "downscales and crops the overflowing axis",
        source: [400, 300],
        target: [100, 100],
        expected: [100, 100],
      },
      {
        label: "crops width when the source is wide",
        source: [800, 200],
        target: [100, 100],
        expected: [100, 100],
      },
      {
        label: "fills the box exactly when enlargement is allowed",
        source: [300, 500],
        target: [400, 400],
        withoutEnlargement: false,
        expected: [400, 400],
      },
      {
        label: "clamps to min(target, source) per axis when enlargement is off",
        source: [300, 500],
        target: [400, 400],
        expected: [300, 400],
      },
      {
        label: "clamps both axes when the source is smaller in both",
        source: [300, 500],
        target: [600, 700],
        expected: [300, 500],
      },
      {
        label: "clamps only the axis that is short",
        source: [300, 500],
        target: [400, 200],
        expected: [300, 200],
      },
      {
        label: "handles a square source into a wide box",
        source: [500, 500],
        target: [400, 100],
        expected: [400, 100],
      },
    ];

    for (const testCase of cases) {
      test(testCase.label, async () => {
        const result = await driver.convert(source(...testCase.source), {
          width: testCase.target[0],
          height: testCase.target[1],
          fit: "cover",
          format: "png",
          ...(testCase.withoutEnlargement !== undefined
            ? { withoutEnlargement: testCase.withoutEnlargement }
            : {}),
        });

        expect([result.width, result.height]).toEqual(testCase.expected);

        // The reported dimensions must match the bytes actually produced —
        // a driver that returns the requested box while emitting something
        // else would corrupt `generated_conversions`.
        const decoded = await decodeResult(result.bytes);
        expect([decoded.width, decoded.height]).toEqual(testCase.expected);
      });
    }
  });

  test("cover with only one dimension behaves as inside", async () => {
    const widthOnly = await driver.convert(source(300, 500), {
      width: 100,
      fit: "cover",
      format: "png",
    });
    expect([widthOnly.width, widthOnly.height]).toEqual([100, 167]);

    const heightOnly = await driver.convert(source(300, 500), {
      height: 100,
      fit: "cover",
      format: "png",
    });
    expect([heightOnly.width, heightOnly.height]).toEqual([60, 100]);
  });

  test("cover keeps the centre, not a corner", async () => {
    // A 400x200 four-quadrant image cropped to 100x100 must straddle all four.
    const result = await driver.convert(quadrants(400, 200), {
      width: 100,
      height: 100,
      fit: "cover",
      format: "png",
    });
    const image = await decodeResult(result.bytes);

    const at = (x: number, y: number): [number, number] => {
      const i = (y * image.width + x) * 4;
      return [image.rgba[i]!, image.rgba[i + 1]!];
    };
    // Corners well inside each quadrant, avoiding the resampled seam.
    expect(at(10, 10)).toEqual([255, 255]); // top-left
    expect(at(89, 10)).toEqual([0, 255]); // top-right
    expect(at(10, 89)).toEqual([255, 0]); // bottom-left
    expect(at(89, 89)).toEqual([0, 0]); // bottom-right
  });

  test("rotation is applied before the cover box is computed", async () => {
    // 400x200 rotated 90° is 200x400 — portrait. Covering a 100x50 box must
    // therefore crop the *height*, which only holds if rotation came first.
    const result = await driver.convert(source(400, 200), {
      width: 100,
      height: 50,
      fit: "cover",
      rotate: 90,
      format: "png",
    });
    expect([result.width, result.height]).toEqual([100, 50]);

    // And a square box from the rotated portrait clamps against the 200px width.
    const clamped = await driver.convert(source(400, 200), {
      width: 300,
      height: 300,
      fit: "cover",
      rotate: 90,
      format: "png",
    });
    expect([clamped.width, clamped.height]).toEqual([200, 300]);
  });

  test("cover never upscales by default", async () => {
    const result = await driver.convert(source(50, 50), {
      width: 500,
      height: 500,
      fit: "cover",
      format: "png",
    });
    expect([result.width, result.height]).toEqual([50, 50]);
  });

  test("fit: inside and fill are unchanged by the crop path", async () => {
    const inside = await driver.convert(source(400, 200), {
      width: 100,
      height: 100,
      fit: "inside",
      format: "png",
    });
    expect([inside.width, inside.height]).toEqual([100, 50]);

    const fill = await driver.convert(source(400, 200), {
      width: 100,
      height: 100,
      fit: "fill",
      format: "png",
    });
    expect([fill.width, fill.height]).toEqual([100, 100]);
  });

  describe("fit: inside — exact dimensions", () => {
    // `Bun.Image` floors internally, so it used to return a width *narrower than
    // the one asked for* (150 -> 149) and a height a pixel off sharp's. Both
    // drivers now resolve dimensions before touching their backend. These are
    // the cases that caught it; they are regression tests, not illustrations.
    const cases: Array<
      [[number, number], number | undefined, number | undefined, [number, number]]
    > = [
      [[300, 500], 100, undefined, [100, 167]],
      [[333, 217], 101, undefined, [101, 66]],
      [[400, 300], 150, undefined, [150, 113]],
      [[1000, 333], 250, undefined, [250, 83]],
      [[123, 457], undefined, 186, [50, 186]],
      [[640, 480], 200, 200, [200, 150]],
      [[900, 150], 100, 100, [100, 17]],
      [[7, 3], 5, undefined, [5, 2]],
    ];

    for (const [[sw, sh], width, height, expected] of cases) {
      test(`${sw}x${sh} inside ${width ?? "-"}x${height ?? "-"} -> ${expected[0]}x${expected[1]}`, async () => {
        const result = await driver.convert(source(sw, sh), {
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
          fit: "inside",
          format: "png",
        });
        expect([result.width, result.height]).toEqual(expected);

        // The requested bound must actually be honoured, not undershot.
        if (width !== undefined) expect(result.width).toBeLessThanOrEqual(width);
        if (height !== undefined) expect(result.height).toBeLessThanOrEqual(height);

        const decoded = await decodeResult(result.bytes);
        expect([decoded.width, decoded.height]).toEqual(expected);
      });
    }

    test("never enlarges by default", async () => {
      const result = await driver.convert(source(50, 50), {
        width: 500,
        height: 500,
        fit: "inside",
        format: "png",
      });
      expect([result.width, result.height]).toEqual([50, 50]);
    });
  });

  describe("fit: fill — the ambiguous corners", () => {
    test("stretches to the box exactly when both dimensions are given", async () => {
      const result = await driver.convert(source(400, 200), {
        width: 100,
        height: 300,
        fit: "fill",
        format: "png",
        withoutEnlargement: false,
      });
      expect([result.width, result.height]).toEqual([100, 300]);
    });

    test("clamps per axis under withoutEnlargement", async () => {
      // The clamp can change the aspect ratio the caller asked to stretch to:
      // 400 is capped to the 300px source width, 400 is under the 500px height.
      const result = await driver.convert(source(300, 500), {
        width: 400,
        height: 400,
        fit: "fill",
        format: "png",
      });
      expect([result.width, result.height]).toEqual([300, 400]);
    });

    test("degrades to inside when given only one dimension", async () => {
      // Not sharp's raw behaviour (it would stretch one axis and leave the
      // other at source size, giving 100x200); normalised so both drivers agree
      // on something a caller might plausibly have meant.
      const result = await driver.convert(source(400, 200), {
        width: 100,
        fit: "fill",
        format: "png",
      });
      expect([result.width, result.height]).toEqual([100, 50]);
    });
  });

  test("re-encodes at source size when no dimensions are given", async () => {
    const result = await driver.convert(source(80, 60), { format: "png" });
    expect([result.width, result.height]).toEqual([80, 60]);
  });

  test("cover round-trips through every portable format", async () => {
    for (const [format, mime] of [
      ["jpeg", "image/jpeg"],
      ["png", "image/png"],
      ["webp", "image/webp"],
    ] as const) {
      const result = await driver.convert(source(400, 300), {
        width: 120,
        height: 120,
        fit: "cover",
        format,
        quality: 80,
      });
      expect(result.mimeType).toBe(mime);
      expect(result.bytes.byteLength).toBeGreaterThan(0);
      expect([result.width, result.height]).toEqual([120, 120]);

      const decoded = await decodeResult(result.bytes);
      expect([decoded.width, decoded.height]).toEqual([120, 120]);
    }
  });

  test("cover preserves alpha into PNG output", async () => {
    const width = 100;
    const height = 100;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = 200;
      rgba[i * 4 + 1] = 100;
      rgba[i * 4 + 2] = 50;
      rgba[i * 4 + 3] = 0x40; // uniformly translucent
    }

    const result = await driver.convert(encodePng({ width, height, rgba }), {
      width: 40,
      height: 40,
      fit: "cover",
      format: "png",
    });

    const decoded = await decodeResult(result.bytes);
    // Resampling a uniform alpha plane must leave it uniform.
    expect(decoded.rgba[3]).toBeCloseTo(0x40, -1);
  });

  test("a 1x1 source does not divide by zero", async () => {
    const result = await driver.convert(source(1, 1), {
      width: 50,
      height: 50,
      fit: "cover",
      format: "png",
    });
    expect([result.width, result.height]).toEqual([1, 1]);
  });
});

/**
 * The drivers agreeing with *themselves* is not the point — this compares them
 * directly, so a change to either shows up as a difference rather than as two
 * separately-passing suites.
 */
describe.skipIf(!sharpInstalled)("BunImageDriver vs SharpImageDriver", () => {
  const bun = new BunImageDriver();
  const sharp = new SharpImageDriver();

  const cases: Array<[string, number, number, number, number]> = [
    ["landscape into square", 400, 300, 100, 100],
    ["portrait into square", 300, 400, 100, 100],
    ["wide panorama into square", 900, 150, 100, 100],
    ["square into wide", 400, 400, 200, 80],
    ["clamped by withoutEnlargement", 300, 500, 400, 400],
    ["odd dimensions", 333, 217, 101, 71],
    ["exact size, no scaling", 200, 200, 200, 200],
  ];

  for (const [label, sw, sh, tw, th] of cases) {
    test(`${label}: identical output dimensions`, async () => {
      const input = source(sw, sh);
      const manipulation = {
        width: tw,
        height: th,
        fit: "cover" as const,
        format: "png" as const,
      };

      const fromBun = await bun.convert(input, manipulation);
      const fromSharp = await sharp.convert(input, manipulation);

      expect([fromBun.width, fromBun.height]).toEqual([fromSharp.width, fromSharp.height]);
    });
  }

  /**
   * A sweep rather than a handful of cases. Rounding disagreements hide in
   * specific ratios — the original 150-becomes-149 bug needed exactly the right
   * source and target to show up — so this covers enough combinations that a
   * reintroduced off-by-one has nowhere to hide.
   */
  // 7 sources x 6 targets x 3 fits x 2 enlargement settings, through both
  // drivers — several hundred real encodes, well past the default timeout.
  test("agree across a sweep of sizes, fits and enlargement settings", async () => {
    const sizes: Array<[number, number]> = [
      [400, 300],
      [333, 217],
      [1000, 333],
      [123, 457],
      [640, 480],
      [50, 50],
      [901, 17],
    ];
    const targets: Array<[number | undefined, number | undefined]> = [
      [100, 100],
      [150, undefined],
      [undefined, 120],
      [101, 71],
      [500, 500],
      [64, 300],
    ];

    const mismatches: string[] = [];

    for (const [sw, sh] of sizes) {
      const input = source(sw, sh);
      for (const [width, height] of targets) {
        for (const fit of ["inside", "fill", "cover"] as const) {
          for (const withoutEnlargement of [true, false]) {
            const manipulation = {
              ...(width !== undefined ? { width } : {}),
              ...(height !== undefined ? { height } : {}),
              fit,
              format: "png" as const,
              withoutEnlargement,
            };
            const fromBun = await bun.convert(input, manipulation);
            const fromSharp = await sharp.convert(input, manipulation);

            if (fromBun.width !== fromSharp.width || fromBun.height !== fromSharp.height) {
              mismatches.push(
                `${sw}x${sh} ${fit} ${width ?? "-"}x${height ?? "-"} wE=${withoutEnlargement}: ` +
                  `bun=${fromBun.width}x${fromBun.height} sharp=${fromSharp.width}x${fromSharp.height}`,
              );
            }
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
  }, 60_000);

  test("crop from the same region, allowing for resampling differences", async () => {
    // The two use different resampling kernels, so pixels never match exactly.
    // A gradient makes position detectable regardless: if one cropped a
    // different region, the mean difference would be large rather than small.
    const input = source(400, 400);
    const manipulation = {
      width: 100,
      height: 100,
      fit: "cover" as const,
      format: "png" as const,
    };

    const fromBun = await decodeResult((await bun.convert(input, manipulation)).bytes);
    const fromSharp = await decodeResult((await sharp.convert(input, manipulation)).bytes);

    let total = 0;
    for (let i = 0; i < fromBun.rgba.length; i++) {
      total += Math.abs(fromBun.rgba[i]! - fromSharp.rgba[i]!);
    }
    const meanDifference = total / fromBun.rgba.length;

    // Empirically ~1 for matching regions; a half-image offset scores >30.
    expect(meanDifference).toBeLessThan(6);
  });
});

test("sharp is installed, so parity is actually enforced", () => {
  // A guard against the suite above silently degrading to Bun-only: if sharp
  // stops resolving in CI, this fails rather than the parity tests vanishing.
  expect(sharpInstalled).toBe(true);
});
