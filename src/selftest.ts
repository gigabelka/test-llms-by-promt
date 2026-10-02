import {
  runLoginCryptoSelfTests,
  runGameCryptoSelfTests,
} from "./crypto/selfTests.ts";
import { selfTestCounts } from "./debug/DebugTools.ts";

runLoginCryptoSelfTests();
runGameCryptoSelfTests();
const { passed, failed } = selfTestCounts();
console.log(`self-tests: ${passed}/${passed + failed}`);
if (failed !== 0) process.exit(1);
