import "dotenv/config";
import { analyseWithAI } from "./recovery-agent.mjs";

const event = {
  id: "ORD-1091",
  amount: 8397,
  providerStatus: "failed",
  providerReason: "insufficient_funds",
  issuer: "Example Bank",
  attempts: 0,
  contacts: 0
};

const incidents = [];

const recovery = {
  attemptCount: 0,
  maxAttempts: 2,
  policySnapshot: {
    optedOut: false
  },
  orderValid: true
};

try {
  console.log("🤖 AI Recovery Agent analysing...\n");

  const decision = await analyseWithAI({
    event,
    incidents,
    recovery
  });

  console.log("AI DECISION:");
  console.log(JSON.stringify(decision, null, 2));
} catch (error) {
  console.error("Agent test failed:");
  console.error(error.message);
}