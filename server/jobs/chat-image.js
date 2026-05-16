const { createJobEvents, publicJob } = require('./common');
const { createChatJobHandlers } = require('./chat');
const { createImageJobHandlers } = require('./image');
const { normalizeReasoningText } = require('./reasoning');

function createJobHandlers({ imageJobs, chatJobs, jobSubscribers, upstreamTimeoutMs }) {
  const { notifyJob, subscribeJob, abortJob } = createJobEvents({ jobSubscribers });
  const imageHandlers = createImageJobHandlers({ imageJobs, notifyJob, upstreamTimeoutMs });
  const chatHandlers = createChatJobHandlers({ chatJobs, notifyJob, upstreamTimeoutMs });

  return {
    ...chatHandlers,
    ...imageHandlers,
    abortJob,
    publicJob,
    notifyJob,
    subscribeJob,
  };
}

module.exports = { createJobHandlers, normalizeReasoningText };
