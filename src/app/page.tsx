import Studio, { type PublicRuntimeConfig } from "@/components/studio";

export default function Home() {
  const config: PublicRuntimeConfig = {
    blobReady: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    aiReady: Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
    saydiReady: Boolean(process.env.SAYDI_API_KEY),
    saydiSpeechSchemaReady: false,
    aiModel: process.env.AI_GATEWAY_MODEL || "openai/gpt-5.4-mini",
    voiceIds: {
      male: process.env.SAYDI_MALE_VOICE_ID || "",
      female: process.env.SAYDI_FEMALE_VOICE_ID || "",
    },
  };

  return <Studio config={config} />;
}
