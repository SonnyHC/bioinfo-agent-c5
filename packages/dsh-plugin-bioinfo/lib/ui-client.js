// Official Harness browser-module format; no additional React runtime.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-bioinfo',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    function BrandName() {
      return h('span', { style: { fontSize: 18, fontWeight: 600, letterSpacing: '-0.025em', whiteSpace: 'nowrap' } }, 'bioinfobuddy');
    }
    function BrandMark({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M7 3c0 6 10 12 10 18M17 3C17 9 7 15 7 21M8 6h8M10 10h4M10 14h4M8 18h8' }));
    }
    // This release exposes a hero brand slot but no headline-text slot. Keep
    // the native hero/composer and scope the presentation to our own marker.
    function AnalysisTitle() {
      return h('span', { className: 'bioinfo-hero-title', role: 'heading', 'aria-level': 1 }, '开始生信分析');
    }
    function WorkbenchLink({ wide }) {
      const url = globalThis.__BIOINFO_WORKBENCH__?.url;
      if (!url) return null;
      return h('a', {
        href: url, target: '_blank', rel: 'noopener noreferrer',
        title: '数据与绘图', 'aria-label': '打开数据与绘图工作台',
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          minHeight: 36, padding: wide ? '0 10px' : '0 8px', borderRadius: 8,
          color: 'var(--dsw-alias-label-secondary)', textDecoration: 'none',
          fontSize: 13, lineHeight: '20px', whiteSpace: 'nowrap',
        },
      }, h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
        h('path', { d: 'M4 4v16h16M8 15v-4m5 4V7m5 8v-6', strokeLinecap: 'round', strokeLinejoin: 'round' })),
      wide ? '数据与绘图' : null);
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          // The distributed shell owns a build-time title, with no runtime
          // title slot. Keep its session prefix while replacing the product.
          const title = document.querySelector('title');
          const syncTitle = () => {
            const current = document.title;
            const next = current === 'DeepSeek Harness' || !current
              ? 'bioinfobuddy' : current.replace(/ — DeepSeek Harness$/, ' — bioinfobuddy');
            if (next !== current) document.title = next;
          };
          syncTitle();
          const observer = new MutationObserver(syncTitle);
          if (title) observer.observe(title, { childList: true, subtree: true, characterData: true });
          return () => observer.disconnect();
        });
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = 'dsh-plugin-bioinfo';
          style.textContent = 'span:has(> [data-slot="conversation.hero.brand.mark"] > .bioinfo-hero-title) + span{display:none}.bioinfo-hero-title{font:inherit;color:inherit}';
          document.head.appendChild(style);
          return () => style.remove();
        });
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: 'bioinfo-workbench', order: 10,
        }, WorkbenchLink));
        ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
          name: 'sidebar.brand.mark', id: 'bioinfobuddy-mark',
        }, BrandMark));
        ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
          name: 'sidebar.brand.name', id: 'bioinfobuddy-name',
        }, BrandName));
        ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
          name: 'conversation.hero.brand.mark', id: 'bioinfo-title',
        }, AnalysisTitle));
      },
    };
  },
});
