import * as fs from 'fs';
import * as path from 'path';

const FLOW_MAIN_FILE = path.resolve(__dirname, '../main.tsx');
const FLOW_PROPOSAL_FILE = path.resolve(__dirname, '../FlowProposalModal.tsx');

const flowMainSource = fs.readFileSync(FLOW_MAIN_FILE, 'utf-8');
const flowProposalSource = fs.readFileSync(FLOW_PROPOSAL_FILE, 'utf-8');

describe('Flow modal template contracts', () => {
  it('uses the shared modal template for the create and edit rule modal', () => {
    expect(flowMainSource).toContain("import { ModalTemplate, ModalTemplateSection } from '../components/ui/modal-template';");
    expect(flowMainSource).toContain('<ModalTemplate');
    expect(flowMainSource).not.toContain('<ModalWrapper');
  });

  it('uses the shared modal template for AI rule suggestions', () => {
    expect(flowProposalSource).toContain("import { ModalTemplate, ModalTemplateSection } from '../components/ui/modal-template';");
    expect(flowProposalSource).toContain('<ModalTemplate');
    expect(flowProposalSource).not.toContain("@radix-ui/react-dialog");
  });
});
