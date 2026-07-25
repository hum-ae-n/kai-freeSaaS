/**
 * why-register.js: the awareness page content for why-register.html
 * (PRD-REGISTER section 12, Phase 11 Wave D). A standalone static page, NOT
 * part of the /my app shell and not routed through js/data-loader.js's
 * boot(): why-register.html mounts this module directly at #awareness-root,
 * the same pattern embed.html uses for its own thin entry point. Every
 * string on this page is authored copy, nothing here renders data from
 * tools.json or a URL parameter, but el()/textContent discipline is kept
 * throughout anyway, matching the rest of the codebase rather than carving
 * out an exception because this page happens to be safe today.
 *
 * Content structure follows section 12 in order: the observed problem, the
 * evidence, the principle (including the verbatim positioning sentence from
 * copy.js), what this is not, the honest threat table (section 10), the
 * verbatim privacy notice (section 11) and exactly one commercial sentence
 * at the close, matching how-we-choose's single-sentence rule.
 */
import { el, themeToggleButton } from '../data-loader.js';
import { POSITIONING_SENTENCE, PRIVACY_NOTICE } from './copy.js';

function renderAwarenessPage(root) {
  const backLink = el('a', { class: 'my-awareness-back', href: '/' }, '← Free Stack');

  const header = el('header', { class: 'panel my-awareness-header' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: 'Kaipability' }),
    el('p', { class: 'eyebrow' }, 'My Stack'),
    el('h1', {}, 'Why we built this'),
    el('p', { class: 't-lede' },
      'A small business that adopts a dozen free tools ends up with a dozen accounts, and usually no record of which email address opened which one, or what needs closing when someone leaves.'),
  );

  const problemSection = el('section', { class: 'my-awareness-section' },
    el('h2', {}, 'What we kept seeing'),
    el('p', { class: 't-body' },
      'Working with small businesses, the same pattern turned up again and again: nobody could say which email had opened the design tool, whether an analytics login belonged to the business or to whoever set it up three years ago, or what a leaver had actually signed up to on their way out the door.'),
    el('p', { class: 't-body' },
      'The clearest version of it: a business Facebook page administered entirely through a personal Gmail address belonging to someone who had left the company two years earlier. Nobody else could get back in.'),
  );

  const evidenceSection = el('section', { class: 'my-awareness-section' },
    el('h2', {}, 'The evidence'),
    el('ul', { class: 'my-awareness-evidence' },
      el('li', { class: 't-body' },
        '63% of businesses have at least one former employee who still has live access to a work account, because closing it down was nobody’s job.'),
      el('li', { class: 't-body' },
        'Unmanaged software subscriptions and the account sprawl around them are estimated to cost UK small and medium businesses up to £10,000 a year: duplicated tools, missed renewals, accounts nobody remembers to cancel.'),
      el('li', { class: 't-body' },
        'The next revision of Cyber Essentials, known as Willow, brings every cloud service a business uses into scope of the assessment, not just the handful earlier versions covered. A business that cannot list its own accounts will struggle to answer those questions.'),
    ),
    el('p', { class: 't-body' },
      'Keeping a register like this helps you prepare for Cyber Essentials, and it supports the account-management questions in a Cyber Essentials self-assessment. It is not a substitute for the independent assessment that certification itself requires.'),
  );

  const principleSection = el('section', { class: 'my-awareness-section' },
    el('h2', {}, 'The principle'),
    el('p', { class: 'my-quote t-lede' }, POSITIONING_SENTENCE),
    el('p', { class: 't-body' },
      'This data should never leave your machine. My Stack keeps the register on the device you are using, and the file you download when you export it is the copy that actually lasts: plain JSON, readable by any computer, still openable in ten years even if Kaipability and this website are both long gone.'),
  );

  const notSection = el('section', { class: 'my-awareness-section' },
    el('h2', {}, 'What this is not'),
    el('p', { class: 't-body' },
      'My Stack is not a password manager, and it never asks for one. There is no password field anywhere in it: not in the form you fill in, not in the file you export, not in how the data is stored. The 2FA field records the method your account uses (an app, a text message, a hardware key), never a secret.'),
    el('p', { class: 't-body' },
      'If you need somewhere to keep the passwords themselves, that is what a password manager is for. My Stack is the keyring label, not the keys.'),
  );

  const threatSection = el('section', { class: 'my-awareness-section' },
    el('h2', {}, 'What a passphrase protects, honestly'),
    el('p', { class: 't-body' },
      'If you turn on encryption, this is what that passphrase genuinely buys you, stated plainly rather than oversold.'),
    el('div', { class: 'my-awareness-threat' },
      el('div', { class: 'is-protects' },
        el('h3', {}, 'A passphrase protects you against'),
        el('ul', {},
          el('li', { class: 't-body' }, 'Someone finding your exported register file: a lost USB stick, a misdirected email attachment.'),
          el('li', { class: 't-body' }, 'A stolen device that is locked.'),
          el('li', { class: 't-body' }, 'A shared family or office computer where other people can open your files.'),
        ),
      ),
      el('div', { class: 'is-not' },
        el('h3', {}, 'A passphrase cannot protect you against'),
        el('ul', {},
          el('li', { class: 't-body' }, 'This page itself being compromised and serving different code than you expect.'),
          el('li', { class: 't-body' }, 'A hostile browser extension reading the page while you have it open.'),
          el('li', { class: 't-body' }, 'Someone reading over your shoulder at an unlocked, already-open screen.'),
        ),
      ),
    ),
  );

  const privacySection = el('section', { class: 'my-awareness-section' },
    el('h2', {}, 'Your privacy'),
    el('p', { class: 't-body' }, PRIVACY_NOTICE),
    el('p', { class: 't-meta' },
      'Found a security issue? Email ',
      el('a', { href: 'mailto:info@kaipability.com' }, 'info@kaipability.com'),
      '; we aim to respond within five working days.'),
  );

  // The one commercial sentence this page allows itself (section 12,
  // "matching how-we-choose's single-sentence rule"). Nowhere else on this
  // page pitches Kaipability's paid work; the workspace link just below is
  // the free tool itself, not an upsell.
  const closingSection = el('section', { class: 'my-awareness-section' },
    el('p', { class: 't-body' },
      'Kaipability built My Stack as part of the free Free Stack directory: the same practice also does paid consultancy work choosing and setting up software stacks for small businesses that would rather not do it themselves.'),
    el('p', { class: 't-body' },
      'Ready to start your own register? ',
      el('a', { href: '/my' }, 'Open My Stack'),
      '.'),
  );

  const footer = el('footer', { class: 'my-awareness-footer' },
    el('img', { class: 'logo', src: 'design-system/assets/kaipability-logo-lockup.png', alt: '' }),
    el('span', {}, 'Kaipability Ltd. No affiliate links, no sponsored placements.'),
    themeToggleButton('btn-ghost btn-sm'),
  );

  root.replaceChildren(backLink, header, problemSection, evidenceSection, principleSection, notSection, threatSection, privacySection, closingSection, footer);
}

renderAwarenessPage(document.getElementById('awareness-root'));
