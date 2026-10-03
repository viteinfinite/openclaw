import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export default {
  id: "local-backoffice",
  name: "Local Backoffice commands",
  description: "Preserve the X to Backoffice commands using the local Virb skill.",
  register(api) {
    for (const name of ["x-to-backoffice", "x-t-backoffice"]) {
      api.registerCommand({
        name,
        description: "Convert an X thread to a Backoffice creation link",
        acceptsArgs: true,
        requireAuth: true,
        async handler(context) {
          let url;
          try {
            url = new URL(context.args?.trim() ?? "");
            if (
              url.protocol !== "https:" ||
              !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) ||
              url.username ||
              url.password ||
              url.port ||
              !/^\/[^/]+\/status\/\d+\/?$/.test(url.pathname)
            )
              throw new Error("Invalid tweet URL");
          } catch {
            return { text: `Usage: /${name} https://x.com/user/status/123456789` };
          }
          const agent = context.config.agents?.entries?.[context.agentId];
          const workspace = agent?.workspace ?? context.config.agents?.defaults?.workspace;
          if (!workspace) return { text: "The agent workspace is not configured." };
          const sandbox = agent?.sandbox ?? context.config.agents?.defaults?.sandbox;
          const credentials = sandbox?.docker?.env ?? {};
          try {
            // Execute the maintained local client directly, without a shell or global Bird.
            const { stdout } = await executeFile(
              process.execPath,
              [
                join(workspace, "skills", "virb", "package", "dist", "cli.js"),
                "thread",
                url.href,
                "--json",
              ],
              {
                cwd: workspace,
                env: {
                  ...process.env,
                  AUTH_TOKEN:
                    credentials.AUTH_TOKEN ?? credentials.BIRD_AUTH_TOKEN ?? process.env.AUTH_TOKEN,
                  CT0: credentials.CT0 ?? credentials.BIRD_CT0 ?? process.env.CT0,
                },
                timeout: 60_000,
                maxBuffer: 5 * 1024 * 1024,
              },
            );
            const tweets = JSON.parse(stdout);
            if (!Array.isArray(tweets) || tweets.length === 0) throw new Error("Empty thread");
            const lines = [];
            for (const [index, tweet] of tweets.entries()) {
              const author = tweet.author ?? {};
              const username = author.username ?? "unknown";
              const quote = "> ".repeat(index);
              const date = tweet.createdAt ? ` • ${tweet.createdAt}` : "";
              lines.push(`${quote}**@${username} (${author.name ?? "Unknown"})${date}**`);
              lines.push(quote);
              lines.push(
                tweet.text
                  ? `${quote}${tweet.text.replace(/\n/g, `  \n${quote}`)}`
                  : `${quote}*[Media or other content]*`,
              );
              lines.push(quote);
              lines.push(`${quote}Link: https://x.com/${username}/status/${tweet.id ?? ""}`);
            }
            return {
              text: `https://backoffice.oltre.dev/create?url=${encodeURIComponent(url.href)}&mdcontent=${encodeURIComponent(lines.join("\n"))}`,
            };
          } catch {
            // Child errors may contain cookies; keep them out of channel replies and logs.
            return {
              text: "Could not fetch the X thread. Check the local Virb credentials and try again.",
            };
          }
        },
      });
    }
  },
};
