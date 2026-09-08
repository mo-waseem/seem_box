import assert from "node:assert/strict";
import { Innertube } from "youtubei.js";
import { getTranscript } from "../src/lib/transcript";

async function main() {
  const originalCreate = Innertube.create;
  let created = 0;
  Innertube.create = async (options) => {
    created++;
    assert.equal(options?.retrieve_player, false, "Caption retrieval must skip the expensive playback JS parser");
    return {
      async getInfo(videoId: string) {
        assert.equal(videoId, "abcdefghijk");
        return {
          basic_info: { title: "Example", author: "Channel", duration: 120 },
          async getTranscript() {
            return {
              selectedLanguage: "English",
              transcript: { content: { body: { initial_segments: [
                { snippet: { text: "Hello" } }, { snippet: { text: "world." } },
              ] } } },
            };
          },
        };
      },
    } as unknown as Awaited<ReturnType<typeof Innertube.create>>;
  };
  try {
    await assert.rejects(getTranscript("invalid"), /YouTube video URL/);
    assert.equal(created, 0);
    assert.deepEqual(await getTranscript("https://youtu.be/abcdefghijk"), {
      videoId: "abcdefghijk", title: "Example", author: "Channel", durationSeconds: 120,
      language: "English", text: "Hello world.",
    });
    assert.equal(created, 1);
    console.log("Transcript checks passed: skips playback JS while preserving metadata and caption extraction.");
  } finally {
    Innertube.create = originalCreate;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
