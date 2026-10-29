import Studio, { type PublicRuntimeConfig } from "@/components/studio";
import { connection } from "next/server";

export default async function Home() {
  await connection();
  const config: PublicRuntimeConfig = {
    aiReady: Boolean(process.env.OPENAI_API_KEY),
    saydiReady: Boolean(process.env.SAYDI_API_KEY),
    saydiSpeechSchemaReady: true,
    aiModel: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    voiceIds: {
      a: process.env.SAYDI_MALE_VOICE_ID || "",
      b: process.env.SAYDI_FEMALE_VOICE_ID || "",
    },
  };

  return <Studio config={config} />;
}
