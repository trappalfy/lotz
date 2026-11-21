const FAQ = [
  { q: "What can I post?", a: "Any static image and an https link. No adult content, scams or wallet drainers. Those get hidden." },
  { q: "Who hides ads?", a: "The Lotz team, on this site. The ad stays on-chain and its lots can still be taken over." },
  { q: "What happens after a year?", a: "Each week's locked tokens unlock 365 days later and go to the treasury." },
  { q: "Do I need SOL?", a: "A little, for fees and the rent of your ad account. You get the rent back when you close an empty ad." },
  { q: "Is it audited?", a: "No. The program is open source. Read it before you buy." },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20">
      <h2 id="faq-title" className="mb-6 text-[28px] font-bold tracking-tight">
        FAQ
      </h2>
      <div className="panel max-w-[760px]">
        {FAQ.map((f) => (
          <details key={f.q} className="group border-b border-grid last:border-b-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[16px] font-semibold [&::-webkit-details-marker]:hidden">
              {f.q}
              <span aria-hidden className="num text-mute group-open:hidden">+</span>
              <span aria-hidden className="num hidden text-mute group-open:inline">−</span>
            </summary>
            <p className="px-5 pb-4 text-[15px] leading-relaxed text-mute">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
