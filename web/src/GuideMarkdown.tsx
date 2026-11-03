import React, { type ReactNode } from 'react';
import { parseGuideInline, type GuideBlock, type GuideInline } from './guide-markdown';

function inlineNodes(nodes: GuideInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === 'text') return <React.Fragment key={index}>{node.text}</React.Fragment>;
    if (node.type === 'code') return <code key={index}>{node.text}</code>;
    if (node.type === 'strong') return <strong key={index}>{inlineNodes(node.children)}</strong>;
    return <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">{inlineNodes(node.children)}</a>;
  });
}

const inline = (text: string) => inlineNodes(parseGuideInline(text));

export default function GuideMarkdown({blocks}: {blocks: GuideBlock[]}) {
  return <div className="guide-document-body">{blocks.map((block, index) => {
    if (block.type === 'heading') return React.createElement(`h${block.level}`, {
      key: block.id, id: block.id, tabIndex: -1, className: 'guide-document-heading', 'data-guide-heading': true,
    }, inline(block.text));
    if (block.type === 'paragraph') return <p key={index}>{inline(block.text)}</p>;
    if (block.type === 'list') {
      const items = block.items.map((item, itemIndex) => <li key={itemIndex} value={block.ordered ? item.value : undefined}>{inline(item.text)}</li>);
      return block.ordered ? <ol key={index} start={block.items[0]?.value}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    return <div key={index} className="guide-table-scroll" role="region" tabIndex={0} aria-label={`${block.label}表格，可横向滚动`}>
      <table><thead><tr>{block.headers.map((cell, cellIndex) => <th key={cellIndex} scope="col" style={{textAlign: block.align[cellIndex]}}>{inline(cell)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} style={{textAlign: block.align[cellIndex]}}>{inline(cell)}</td>)}</tr>)}</tbody>
      </table>
    </div>;
  })}</div>;
}
