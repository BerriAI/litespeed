import { chromium, type Browser, type Page } from 'playwright';
import { writeFile } from 'node:fs/promises';
import type { ComputerDriver } from '../server/computer.js';

/** A deterministic rendered test window. It never observes or drives the OS. */
export class ComputerFixture implements ComputerDriver {
  private browser?: Browser;
  private page?: Page;
  private sequence = 0;
  captureAvailable = true;
  calls: string[] = [];
  lastDrag?: Record<string, unknown>;
  async inspect() {
    const page = await this.window(), slider = page.getByLabel('Text size');
    return { calls: this.calls, lastDrag: this.lastDrag, slider: { bounds: await slider.boundingBox(), value: await slider.inputValue() } };
  }
  private async window() {
    if (!this.page) {
      this.browser = await chromium.launch({ channel: 'chrome', headless: true });
      this.page = await this.browser.newPage({ viewport: { width: 960, height: 640 } });
      await this.page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#f7f5ef;color:#302f2b;font:18px system-ui}header{height:42px;background:#eceae4;display:flex;align-items:center;padding:0 18px;border-bottom:1px solid #d8d5ce}header i{width:11px;height:11px;border-radius:100%;background:#ff615a;margin-right:8px}header i:nth-child(2){background:#ffbf30}header i:nth-child(3){background:#2bc840}header span{margin:auto;font-size:13px;color:#65645f;transform:translateX(-25px)}main{max-width:640px;margin:70px auto}small{color:#898579;font-size:12px;letter-spacing:1.4px}h1{font-size:34px;font-weight:550;letter-spacing:-1px;margin:16px 0 28px}label{display:block;color:#737066;font-size:13px;margin:22px 0 8px}textarea{font:18px/1.7 system-ui;color:#34322b;border:1px solid #d9d5ca;border-radius:9px;background:#fffefa;width:100%;height:160px;padding:18px;resize:none}footer{font-size:12px;color:#969183;margin-top:18px}</style><header><i></i><i></i><i></i><span>Project notes</span></header><main><small>WORKSPACE NOTES</small><h1>A little space to think.</h1><label for="note">A note for the project</label><textarea id="note" aria-label="Note">A simple, focused place to build.</textarea><footer>Notes stay with your project.</footer></main>`);
    }
    if (!await this.page.getByLabel('Text size').count()) await this.page.locator('main').evaluate(main => {
      const label = document.createElement('label'); label.htmlFor = 'size'; label.textContent = 'Text size';
      const slider = document.createElement('input'); slider.id = 'size'; slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = '25'; slider.style.width = '100%';
      main.append(label, slider);
    });
    return this.page;
  }
  async call(tool: string, args: Record<string, any>, signal?: AbortSignal): Promise<unknown> {
    this.calls.push(tool); if (this.calls.length > 200) this.calls.shift(); signal?.throwIfAborted();
    if (tool === 'check_permissions') return { accessibility: true, screen_recording: true };
    if (tool === 'list_apps') return { apps: [{ bundle_id: 'ai.litespeed.fixture.notes', name: 'Fixture Notes', running: true, active: false }, { bundle_id: 'com.apple.Terminal', name: 'Terminal', running: true, active: false }] };
    if (tool === 'launch_app') return { pid: 7331, bundle_id: 'ai.litespeed.fixture.notes' };
    if (tool === 'start_session' || tool === 'end_session') return { ok: true };
    if (tool === 'get_accessibility_tree') return { apps: [{ pid: 7331, name: 'Fixture Notes', bundle_id: 'ai.litespeed.fixture.notes' }], windows: [{ pid: 7331, window_id: 9001, title: 'Project notes' }] };
    if (tool === 'get_window_state') {
      if (!this.captureAvailable) return { pid: 7331, window_id: 9001, elements: [], screenshot_frame_valid: false, screenshot_error: { code: 'px_capture_unavailable', reason: 'Controlled fixture capture is unavailable.' } };
      const page = await this.window(), snapshot = `s${(++this.sequence).toString(16).padStart(8, '0')}`;
      await writeFile(args.screenshot_out_file, await page.screenshot({ type: 'png' }));
      return { pid: 7331, window_id: 9001, screenshot_frame_valid: true, screenshot_width: 960, screenshot_height: 640, screenshot_file_path: args.screenshot_out_file, snapshot_id: snapshot, elements: [{ element_token: `${snapshot}:1`, role: 'AXTextArea', label: 'Note', value: await page.getByLabel('Note', { exact: true }).inputValue() }] };
    }
    const page = await this.window();
    if (tool === 'click') { if (args.element_token) await page.getByLabel('Note', { exact: true }).click(); else await page.mouse.click(args.x, args.y); }
    else if (tool === 'drag') { this.lastDrag = { ...args }; await page.mouse.move(args.from_x, args.from_y); await page.mouse.down(); await page.mouse.move(args.to_x, args.to_y, { steps: args.steps }); await page.mouse.up(); }
    else if (tool === 'type_text') { if (args.element_token) await page.getByLabel('Note', { exact: true }).fill(args.text); else await page.keyboard.insertText(args.text); }
    else if (tool === 'press_key') { const key = ({return:'Enter',tab:'Tab',delete:'Backspace',up:'ArrowUp',down:'ArrowDown'} as Record<string,string>)[args.key] || args.key; await page.keyboard.press((args.modifiers?.includes('cmd') ? 'ControlOrMeta+' : '') + key); }
    else if (tool === 'scroll') await page.mouse.wheel(0, (args.direction === 'up' ? -1 : 1) * (args.amount || 3) * 60);
    return { effect: 'unverifiable' };
  }
  async close() { await this.browser?.close(); }
}
