import Studio, { type PublicRuntimeConfig } from "@/components/studio";

export default function Home() {
  const config: PublicRuntimeConfig = {
    aiReady: Boolean(process.env.OPENAI_API_KEY),
    saydiReady: Boolean(process.env.SAYDI_API_KEY),
    saydiSpeechSchemaReady: true,
    aiModel: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    voiceIds: {
      male: process.env.SAYDI_MALE_VOICE_ID || "",
      female: process.env.SAYDI_FEMALE_VOICE_ID || "",
    },
  };

  return <Studio config={config} />;
}
