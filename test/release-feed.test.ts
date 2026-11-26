import {expect,it} from 'vitest';
import {parseFeed} from '../src/rss.js';
it('preserves the publisher URL and readable evidence from an RSS item',()=>{
  const xml='<rss version="2.0"><channel><item><title>Atlas prepara el partido</title><link>https://example.org/deportes/atlas</link><pubDate>Thu, 26 Nov 2026 12:00:00 GMT</pubDate><description><![CDATA[<p>Atlas confirma la baja de López.</p>]]></description></item></channel></rss>';
  const articles=parseFeed(xml,'https://example.org/deportes/rss');
  expect(articles).toHaveLength(1);
  expect(articles[0].url).toBe('https://example.org/deportes/atlas');
  expect(articles[0].text).toContain('Atlas confirma la baja de López.');
  expect(articles[0].text).not.toContain('<p>');
});
