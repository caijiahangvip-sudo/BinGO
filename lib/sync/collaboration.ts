import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

export type CollaborationDocumentKind = 'stage' | 'whiteboard' | 'annotation' | 'answer';

export interface CollaborationConnectionOptions {
  websocketUrl: string;
  organizationId: string;
  kind: CollaborationDocumentKind;
  documentId: string;
  accessToken: string | (() => string) | (() => Promise<string>);
  document?: Y.Doc;
}

export function createCollaborationConnection(options: CollaborationConnectionOptions) {
  const document = options.document ?? new Y.Doc();
  const provider = new HocuspocusProvider({
    url: options.websocketUrl.replace(/\/+$/, ''),
    name: `org/${options.organizationId}/${options.kind}/${options.documentId}`,
    document,
    token: options.accessToken,
  });
  return { document, provider };
}
