import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic } from "langsmith/wrappers/anthropic";

export const anthropicClient = wrapAnthropic(
  new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
);
