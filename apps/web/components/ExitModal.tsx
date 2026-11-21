"use client";

import { Modal } from "./Modal";

/** Shown before every outgoing ad link (brief §2.8, §8). */
export function ExitModal({ link, domain, onClose }: { link: string; domain: string; onClose: () => void }) {
  return (
    <Modal title="You're leaving Lotz." onClose={onClose} width={400}>
      <p className="text-[15px] leading-relaxed">
        This link goes to <span className="num font-semibold break-all">{domain}</span>.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-mute">Ads are posted by anyone. Check before you connect a wallet.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a
          data-autofocus
          className="btn btn-primary"
          href={link}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          referrerPolicy="no-referrer"
          onClick={onClose}
        >
          Go to {domain}
        </a>
        <button type="button" className="btn" onClick={onClose}>
          Stay
        </button>
      </div>
    </Modal>
  );
}
