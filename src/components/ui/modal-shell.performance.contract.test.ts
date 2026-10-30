import * as fs from 'fs';
import * as path from 'path';

const DIALOG_FILE = path.resolve(__dirname, './dialog.tsx');
const MODAL_WRAPPER_FILE = path.resolve(__dirname, '../../popup/components/modals/ModalWrapper.tsx');

const dialogSource = fs.readFileSync(DIALOG_FILE, 'utf-8');
const modalWrapperSource = fs.readFileSync(MODAL_WRAPPER_FILE, 'utf-8');

describe('shared modal shell performance contract', () => {
  it('avoids backdrop blur in the shared dialog primitives', () => {
    expect(dialogSource).not.toContain('backdrop-blur');
  });

  it('avoids backdrop blur in popup modal wrapper surfaces', () => {
    expect(modalWrapperSource).not.toContain('backdrop-blur');
  });
});
