import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {AiWorkspaceView} from '../src/renderer/AiWorkspace.js';

describe('AiWorkspaceView', () => {
  it('renders an accessible loading state before local workspace data is ready', () => {
    const markup = renderToStaticMarkup(
      <AiWorkspaceView
        projectId="project-1"
        projectQuestion="What changed?"
        targetDurationSec={480}
        language="en"
      />,
    );

    expect(markup).toContain('Đang kết nối không gian AI trên máy');
    expect(markup).toContain('ai-loading');
  });
});
