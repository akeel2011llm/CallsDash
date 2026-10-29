import { describe, expect, it } from "vitest";
import { splitPhotos } from "../lib/chat-photos";

const ours = (u: string) => (/^https:\/\/app\.example\/api\/items\/[^/]+\/[^/]+\/image$/.test(u) ? u : null);

describe("photos inside a typed chat reply", () => {
  it("turns the assistant's markdown image into a picture between the text around it", () => {
    const parts = splitPhotos("Here is Dr. Aqeel:\n\n![Dr. Aqeel](https://app.example/api/items/al-noor/d1/image)\n\nWould you like to book?", ours);
    expect(parts).toEqual([
      { text: "Here is Dr. Aqeel:" },
      { image: "https://app.example/api/items/al-noor/d1/image", alt: "Dr. Aqeel" },
      { text: "Would you like to book?" },
    ]);
  });

  it("leaves pictures from anywhere else as text and handles a reply that is only a picture", () => {
    expect(splitPhotos("Look ![x](https://evil.example/a.png)", ours)).toEqual([{ text: "Look ![x](https://evil.example/a.png)" }]);
    expect(splitPhotos("![Cream](https://app.example/api/items/c/i1/image)", ours)).toEqual([{ image: "https://app.example/api/items/c/i1/image", alt: "Cream" }]);
    expect(splitPhotos("No photo here.", ours)).toEqual([{ text: "No photo here." }]);
  });
});

describe("website widget photo size", () => {
  it("uses the same rule as the dashboard", async () => {
    const { readFileSync } = await import("node:fs");
    const { CHAT_PHOTO_CSS } = await import("../lib/chat-photos");
    expect(readFileSync("public/widget.js", "utf8")).toContain(CHAT_PHOTO_CSS);
  });
});
