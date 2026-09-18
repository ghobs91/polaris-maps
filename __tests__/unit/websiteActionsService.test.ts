import {
  extractActionLinksFromHtml,
  extractJsonLdActions,
  parseWebsiteActionsFromHtml,
  resolveActionUrl,
} from '../../src/services/poi/websiteActionsService';

const BASE = 'https://rolos.example.com/';

describe('resolveActionUrl', () => {
  it('resolves relative hrefs against the page URL', () => {
    expect(resolveActionUrl('/order', BASE)).toBe('https://rolos.example.com/order');
  });

  it('rejects non-http(s) and fragment hrefs', () => {
    expect(resolveActionUrl('mailto:a@b.com', BASE)).toBeNull();
    expect(resolveActionUrl('tel:+15551234', BASE)).toBeNull();
    expect(resolveActionUrl('#menu', BASE)).toBeNull();
    expect(resolveActionUrl('javascript:void(0)', BASE)).toBeNull();
  });
});

describe('extractActionLinksFromHtml', () => {
  it('detects order/reserve/menu by anchor text', () => {
    const html = `
      <a href="/order-online">Order Online</a>
      <a href="/book-a-table">Book a table</a>
      <a href="/food">Our Menu</a>
    `;
    const actions = extractActionLinksFromHtml(html, BASE);
    expect(actions.map((a) => a.kind).sort()).toEqual(['menu', 'order', 'reserve']);
  });

  it('recognizes third-party providers and labels them', () => {
    const html = `<a href="https://www.opentable.com/r/rolos">Reservations</a>
      <a href="https://order.doordash.com/store/rolos">Order</a>`;
    const actions = extractActionLinksFromHtml(html, BASE);
    expect(actions).toContainEqual({
      kind: 'reserve',
      url: 'https://www.opentable.com/r/rolos',
      provider: 'OpenTable',
    });
    expect(actions.find((a) => a.kind === 'order')?.provider).toBe('DoorDash');
  });

  it('ignores tel/mailto and unrelated links', () => {
    const html = `<a href="tel:+15551234">Call</a><a href="/about">About us</a>`;
    expect(extractActionLinksFromHtml(html, BASE)).toEqual([]);
  });
});

describe('extractJsonLdActions', () => {
  it('reads hasMenu and potentialAction targets', () => {
    const html = `<script type="application/ld+json">
      {
        "@type": "Restaurant",
        "hasMenu": "https://rolos.example.com/menu.pdf",
        "potentialAction": [
          { "@type": "ReserveAction", "target": { "urlTemplate": "https://resy.com/rolos" } }
        ]
      }
    </script>`;
    const actions = extractJsonLdActions(html, BASE);
    expect(actions).toContainEqual({ kind: 'menu', url: 'https://rolos.example.com/menu.pdf' });
    expect(actions).toContainEqual({ kind: 'reserve', url: 'https://resy.com/rolos' });
  });

  it('ignores malformed JSON', () => {
    expect(extractJsonLdActions('<script type="application/ld+json">{oops</script>', BASE)).toEqual(
      [],
    );
  });
});

describe('parseWebsiteActionsFromHtml', () => {
  it('keeps the first candidate per kind and dedupes', () => {
    const html = `
      <script type="application/ld+json">
        { "@type": "Restaurant", "hasMenu": "https://rolos.example.com/menu.pdf" }
      </script>
      <a href="/menu">Menu</a>
      <a href="/order">Order</a>
    `;
    const actions = parseWebsiteActionsFromHtml(html, BASE);
    expect(actions).toHaveLength(2);
    const menu = actions.find((a) => a.kind === 'menu');
    expect(menu?.url).toBe('https://rolos.example.com/menu.pdf');
    expect(actions.find((a) => a.kind === 'order')?.url).toBe('https://rolos.example.com/order');
  });
});
