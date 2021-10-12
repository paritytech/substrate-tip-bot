import fs from 'fs';
import path from 'path';

import nock from 'nock';
import { Probot, ProbotOctokit } from 'probot';
import { assert } from 'chai';

import myProbotApp from '../src/bot';
import payload from './fixtures/issues.opened.json';

describe('Substrate tip bot', () => {
  let probot;
  const issueCreatedBody = { body: 'Thanks for opening this issue!' };

  const privateKey = fs.readFileSync(
    path.join(__dirname, 'fixtures/mock-cert.pem'),
    'utf-8'
  );

  beforeEach(() => {
    nock.disableNetConnect();

    probot = new Probot({
      appId: 123,
      privateKey,
      // disable request throttling and retries for testing
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });

    probot.load(myProbotApp);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('creates a comment when an issue is opened', async () => {
    const mock = nock('https://api.github.com')
      // Test that we correctly return a test token
      .post('/app/installations/2/access_tokens')
      .reply(200, {
        token: 'test',
        permissions: {
          issues: 'write',
        },
      })

      // Test that a comment is posted
      .post('/repos/hiimbex/testing-things/issues/1/comments', (body) => {
        assert.deepEqual(body, issueCreatedBody);
        return true;
      })
      .reply(200);

    // Receive a webhook event
    await probot.receive({ name: 'issues', payload });

    assert.strictEqual(mock.pendingMocks(), []);
  });
});
