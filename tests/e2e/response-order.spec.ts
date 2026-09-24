import { test, expect, type Locator } from './fixtures';

const readingOrder = (message: Locator) => message.locator('.message-body').evaluate(node => [...node.children]
  .filter(child => child.matches('.markdown, .work-log'))
  .map(child => child.matches('.work-log') ? 'Thinking' : child.textContent?.trim()));

for (const thinkingFirst of [true, false]) test(`anchors thinking where it starts (${thinkingFirst ? 'before' : 'after'} text), including reload`, async ({ page, request }) => {
  const response = await request.post('/api/sessions', { data: { title: 'Thinking order', providerId: 'fixture', model: 'test-model', architecture: null } });
  expect(response.ok()).toBe(true); const session = await response.json();
  const advance = async () => { expect((await request.post('/fixture/response-order/advance')).ok()).toBe(true); };
  try {
    await page.goto(`/#session/${session.id}`);
    expect((await request.post(`/api/sessions/${session.id}/messages`, { data: { content: `WEB_RESPONSE_ORDER ${thinkingFirst ? 'THINKING_FIRST' : 'LATER_THINKING'}` } })).ok()).toBe(true);
    const message = page.getByRole('article', { name: 'Assistant message', exact: true });
    if (thinkingFirst) {
      await expect(message.locator('.work-log.active summary')).toHaveText('Thinking');
      await expect.poll(() => readingOrder(message)).toEqual(['Thinking']);
      await advance();
      await expect.poll(() => readingOrder(message)).toEqual(['Thinking', 'Here is the answer.']);
      await expect(message.locator('.work-log')).not.toHaveAttribute('open');
      const thought = await message.locator('.work-log').boundingBox(), answer = await message.locator('.message-body > .markdown').boundingBox();
      expect(thought!.y + thought!.height).toBeLessThanOrEqual(answer!.y + 1);
    } else {
      await expect.poll(() => readingOrder(message)).toEqual(['First, an observation.']);
      await advance();
      await expect(message.locator('.work-log.active summary')).toHaveText('Thinking');
      await expect.poll(() => readingOrder(message)).toEqual(['First, an observation.', 'Thinking']);
      await page.reload();
      await expect.poll(() => readingOrder(message)).toEqual(['First, an observation.', 'Thinking']);
      await advance();
      await expect.poll(() => readingOrder(message)).toEqual(['First, an observation.', 'Thinking', 'Now a conclusion.']);
      await advance();
      await expect.poll(() => readingOrder(message)).toEqual(['First, an observation.', 'Thinking', 'Now a conclusion.', 'Thinking']);
      await advance();
      await expect.poll(() => readingOrder(message)).toEqual(['First, an observation.', 'Thinking', 'Now a conclusion.', 'Thinking', 'The final result.']);
    }
    await advance();
    await expect(page.getByRole('button', { name: 'Stop generation', exact: true })).toHaveCount(0);
    const completedOrder = await readingOrder(message);
    await page.reload(); await expect.poll(() => readingOrder(message)).toEqual(completedOrder);
    await expect(message.locator('.work-log.active')).toHaveCount(0);
    await page.screenshot({ path: `.ui-audit/response-order-${thinkingFirst ? 'first' : 'later'}.png`, animations: 'disabled' });
  } finally {
    await request.post(`/api/sessions/${session.id}/cancel`);
    await request.delete(`/api/sessions/${session.id}`);
  }
});
