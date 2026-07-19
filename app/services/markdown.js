const MarkdownIt = require('markdown-it');

const renderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false
});

const defaultLinkOpen = renderer.renderer.rules.link_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer nofollow');
  return defaultLinkOpen(tokens, index, options, env, self);
};

function renderMarkdown(value) {
  return renderer.render(String(value || '').slice(0, 200_000));
}

module.exports = { renderMarkdown };
