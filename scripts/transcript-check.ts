import { getTranscript } from "../src/lib/transcript";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx tsx scripts/transcript-check.ts <youtube-url>");
    process.exit(1);
  }
  const transcript = await getTranscript(url);
  console.log(`${transcript.title} — ${transcript.author}`);
  console.log(`language: ${transcript.language ?? "unknown"} · characters: ${transcript.text.length}`);
  console.log(transcript.text.slice(0, 400));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
