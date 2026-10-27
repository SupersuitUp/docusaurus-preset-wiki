import React, { useEffect, useState } from 'react';
import { actReturn, linkForPage, mintAndCopy } from '../../share/mintAndCopy';

/**
 * Copy a link that is the right SIZE for the person receiving it.
 *
 * On a gated wiki the edge mints a focused share address for this page
 * (/s/<sig>/<route>, see src/share/signedRoute.ts): one page, chrome-less, no
 * password and no way into the rest of the wiki. On an open wiki the edge hands
 * back the page's own URL, and where there is no edge at all (local dev, a wiki
 * whose middleware predates sharing) the button copies the clean page URL. It
 * never copies nothing: the fallback is always a link.
 *
 * The clipboard is opened BEFORE the mint request, on a promise, because iOS
 * Safari expires the tap's activation across an await (src/share/mintAndCopy.ts).
 *
 * On an act-mode wiki (public to read, sign in to share) a reader with no sign-in is sent to the
 * Supersuit sign-in and back to this page with `?act=share`; the button then finishes the share
 * on load and shows the link, since the tap that would open the clipboard is long gone.
 */
export default function ShareButton(): React.JSX.Element {
  const [label, setLabel] = useState<'idle' | 'minting' | 'copied' | 'copied-page' | 'shown' | 'admin-only' | 'signing-in'>('idle');
  const [shown, setShown] = useState<string | null>(null);

  // Back from signing in to share: take the marker off the address and finish the mint.
  useEffect(() => {
    const back = actReturn(window.location.href);
    if (!back.finish) return;
    window.history.replaceState(window.history.state, '', back.clean);
    setLabel('minting');
    void linkForPage(window.location.href).then((link) => {
      if (link.signIn || link.adminOnly) { setLabel(link.adminOnly ? 'admin-only' : 'idle'); return; }
      setShown(link.url);
      setLabel('shown');
    });
  }, []);

  const handleClick = async () => {
    setLabel('minting');
    let result: { url: string; copied: boolean; focused: boolean };
    let adminOnly = false;
    let signIn: string | undefined;
    try {
      let focused = false;
      const r = await mintAndCopy({
        mint: async () => {
          const link = await linkForPage(window.location.href);
          focused = link.focused;
          // Not a share admin: refuse here, so nothing that looks like a share reaches the clipboard.
          if (link.adminOnly) { adminOnly = true; throw new Error('not_share_admin'); }
          // Act mode with no sign-in: nothing goes on the clipboard; the reader signs in first.
          if (link.signIn) { signIn = link.signIn; throw new Error('sign_in_to_act'); }
          return link.url;
        },
        clipboard: typeof navigator !== 'undefined' ? navigator.clipboard : undefined,
      });
      result = { ...r, focused };
    } catch {
      if (signIn) {
        setLabel('signing-in');
        window.location.assign(signIn);
        return;
      }
      if (adminOnly) {
        setLabel('admin-only');
        setTimeout(() => setLabel('idle'), 3000);
        return;
      }
      // linkForPage never throws, so this is the clipboard machinery itself failing.
      result = { url: window.location.origin + window.location.pathname, copied: false, focused: false };
    }
    if (result.copied) {
      setLabel(result.focused ? 'copied' : 'copied-page');
      setTimeout(() => setLabel('idle'), 2200);
    } else {
      // Nothing reached the clipboard: show the link so a long-press can take it.
      setShown(result.url);
      setLabel('shown');
    }
  };

  const text =
    label === 'minting' ? 'minting…'
    : label === 'copied' ? 'copied · this page only'
    : label === 'copied-page' ? 'copied'
    : label === 'shown' ? 'copy this:'
    : label === 'admin-only' ? 'only wiki admins can share pages'
    : label === 'signing-in' ? 'sign in to share…'
    : 'copy link';

  return (
    <span className="doc-share-button" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <button
        onClick={handleClick}
        style={{
          margin: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.35rem 0.7rem',
          fontFamily: 'var(--ifm-font-family-monospace)',
          fontSize: '0.8rem',
          background: 'transparent',
          border: '1px solid var(--ifm-color-emphasis-300)',
          borderRadius: '4px',
          color: 'var(--ifm-color-emphasis-700)',
          cursor: 'pointer',
        }}
        aria-label="Copy a link to this page"
      >
        {text}
      </button>
      {shown ? (
        <input
          readOnly
          value={shown}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            fontFamily: 'var(--ifm-font-family-monospace)',
            fontSize: '0.75rem',
            padding: '0.3rem 0.5rem',
            border: '1px solid var(--ifm-color-emphasis-300)',
            borderRadius: '4px',
            background: 'transparent',
            color: 'var(--ifm-color-emphasis-800)',
            minWidth: '16rem',
          }}
          aria-label="Share link"
        />
      ) : null}
    </span>
  );
}
