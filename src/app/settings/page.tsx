import type { Metadata } from "next";
import { connection } from "next/server";
import SettingsTool from "@/components/settings-tool";
import { getProviderStatus } from "@/lib/llm";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  await connection();
  const status = await getProviderStatus();
  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Configure the LLM provider used by seem_box tools.
        </p>
      </div>
      <SettingsTool initialStatus={status} />
    </section>
  );
}
