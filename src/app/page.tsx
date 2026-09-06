import Link from "next/link";

type Tool = {
  name: string;
  description: string;
  href: string | null;
  ready: boolean;
};

const tools: Tool[] = [
  {
    name: "YouTube Summary",
    description:
      "Paste a YouTube link and get a structured summary, key takeaways and a conclusion from the captions.",
    href: "/youtube-summary",
    ready: true,
  },
  {
    name: "More tools",
    description: "seem_box grows one tool at a time. New utilities will land here.",
    href: null,
    ready: false,
  },
];

export default function HomePage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Your toolbox</h1>
      <p className="mt-2 text-sm text-neutral-400">Small utilities that do one thing well.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {tools.map((tool) => {
          const cardClass = tool.ready
            ? "block rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 transition-colors hover:border-neutral-600"
            : "rounded-xl border border-neutral-900 bg-neutral-900/20 p-5 opacity-60";
          const body = (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-medium text-neutral-100">{tool.name}</h2>
                <span
                  className={
                    tool.ready
                      ? "text-[10px] uppercase tracking-wider text-emerald-400"
                      : "text-[10px] uppercase tracking-wider text-neutral-500"
                  }
                >
                  {tool.ready ? "ready" : "soon"}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-neutral-400">{tool.description}</p>
            </>
          );
          return tool.ready && tool.href ? (
            <Link key={tool.name} href={tool.href} className={cardClass}>
              {body}
            </Link>
          ) : (
            <div key={tool.name} className={cardClass}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
