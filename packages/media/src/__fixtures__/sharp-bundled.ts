/**
 * The entry `SharpImageDriver.test.ts` bundles and runs, standing in for a compiled app.
 *
 * Built with `sharp` left external and run from a directory with no `node_modules`, as a
 * compiled app deployed without sharp runs. Prints one line of JSON: what encoding a PNG
 * through the driver did.
 */
import { SharpImageDriver } from "../conversions/SharpImageDriver.ts";

try {
  console.log(JSON.stringify({ png: await new SharpImageDriver().canEncode("png") }));
} catch (error) {
  const thrown = error as Error & { code?: string; missing?: { install?: string } };
  console.log(
    JSON.stringify({
      threw: thrown.name,
      code: thrown.code,
      install: thrown.missing?.install,
      message: thrown.message.split("\n")[0],
    }),
  );
}
