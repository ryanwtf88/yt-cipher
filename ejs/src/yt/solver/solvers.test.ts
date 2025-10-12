import { getFromPrepared, preprocessPlayer } from "./solvers.ts";
import { players, tests } from "./test/tests.ts";
import { getCachePath } from "./test/utils.ts";
import { getIO } from "./test/io.ts";

const io = await getIO();

for (const test of tests) {
  for (const variant of test.variants ?? players.keys()) {
    const path = getCachePath(test.player, variant);
    await io.test(`${test.player} ${variant}`, async (assert, subtest) => {
      // Skip test if player file doesn't exist
      if (!(await io.exists(path))) {
        console.log(`Skipping test for ${test.player} ${variant} - player file not found`);
        return;
      }
      
      const content = await io.read(path);
      const solvers = getFromPrepared(preprocessPlayer(content));
      for (const mode of ["n", "sig"] as const) {
        for (const step of test[mode] || []) {
          await subtest(`${step.input} (${mode})`, () => {
            const got = solvers[mode]?.(step.input);
            assert.equal(got, step.expected);
          });
        }
      }
    });
  }
}
