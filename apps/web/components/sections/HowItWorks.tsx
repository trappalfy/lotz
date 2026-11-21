import { Cells } from "../Cells";
import { PixelText } from "../PixelText";

/** Illustrations drawn in cells on the same 10 px grid as the board (brief §5.3). */
const PICK = [
  "oooooooooooooo",
  "oooooooooooooo",
  "ooo######ooooo",
  "ooo#....#ooooo",
  "ooo#....#ooooo",
  "ooo#....#.#ooo",
  "ooo######.##oo",
  "oooooooooo###o",
  "oooooooooo####",
  "oooooooooo##oo",
];
const PAY = [
  "..............",
  "...........##.",
  "..........#..#",
  "..........#..#",
  "###.......####",
  "###...#...####",
  "###....#..####",
  "#########.####",
  "###....#..####",
  "###...#.......",
];
const LIVE = [
  "oooooooooooooo",
  "o#######oooooo",
  "o#.#.#.#oooooo",
  "o##.#.##oooooo",
  "o#.#.#.#oooooo",
  "o##.#.##o#oooo",
  "o#######o##ooo",
  "ooooooooo###oo",
  "ooooooooo####o",
  "ooooooooo##ooo",
];
const BACK = [
  "..............",
  ".#####........",
  ".#####....#...",
  ".###.#...##...",
  ".#####..######",
  ".#####...##..#",
  "..........#..#",
  ".............#",
  "..........####",
  "..............",
];

const STEPS = [
  { art: PICK, title: "Pick a spot.", text: "Drag across the board. Any rectangle up to 10×10 lots." },
  { art: PAY, title: "Pay in the token.", text: "Free lots cost the current price. Taken lots cost 1.5x what was last paid." },
  { art: LIVE, title: "Go live.", text: "Your image, your link, your title on hover." },
  { art: BACK, title: "Lose a lot, get it back.", text: "If someone takes your lot, every token you paid for it comes back to you." },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-20">
      <PixelText text="How it works" rows={9} cell={10} className="mb-10" />
      <span id="how-title" className="sr-only">How it works</span>
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="panel flex flex-col p-5">
            <div className="flex items-start justify-between">
              <Cells rows={s.art} />
              <span className="num text-[13px] text-mute">{i + 1}</span>
            </div>
            <h3 className="mt-5 text-[17px] font-semibold">{s.title}</h3>
            <p className="mt-1 text-[14px] leading-relaxed text-mute">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
