import { hostImport } from './host.js';
import { callApi, resourceId, workbenchUrl } from './client.js';

const { defineTool } = await hostImport('@deepseek-ai/dsh-tools');
export const name = 'bioinfo-tools';
export const inject = ['tools'];

const text = (description, required = false) => ({ type: 'string', description, ...(required ? { required: true } : {}) });
const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
const identifier = (kind) => text(`${kind} ID returned by the workbench.`, true);

export function createTools() {
  return [
    defineTool({
      name: 'bio_open_workbench',
      description: 'Return the link to the local data and plotting workbench. Use it for importing a table or opening a plan or result.',
      parameters: { planId: text('Optional existing plan ID.'), runId: text('Optional existing run ID.') },
      output, isConcurrencySafe: () => true,
      execute: ({ planId, runId }) => ({ workbenchUrl: workbenchUrl({ planId, runId }) }),
    }),
    defineTool({
      name: 'bio_list_datasets',
      description: 'List imported tables with their names, schema, and row counts.',
      parameters: {}, output, isConcurrencySafe: () => true,
      execute: (_args, exec) => callApi('/api/datasets', { signal: exec.signal }),
    }),
    defineTool({
      name: 'bio_inspect_dataset',
      description: 'Inspect an imported table: column names, types, missing values, and a data preview.',
      parameters: { datasetId: identifier('Dataset') }, output, isConcurrencySafe: () => true,
      execute: ({ datasetId }, exec) => callApi(`/api/datasets/${resourceId(datasetId)}`, { signal: exec.signal }),
    }),
    defineTool({
      name: 'bio_preview_plan',
      description: 'Create a plotting plan using inspected source columns and explicit missing-value handling. Return a workbench link for the user to review and confirm the plan.',
      parameters: {
        datasetId: identifier('Dataset'),
        chart: { type: 'string', enum: ['box', 'violin', 'scatter', 'histogram', 'bar', 'heatmap'], required: true },
        layout: { type: 'string', enum: ['long', 'wide'], required: true },
        x: text('Exact source column for x or groups; omit if not needed.'),
        y: text('Exact numeric source column for y; omit if not needed.'),
        group: text('Optional exact source column for color or group.'),
        valueColumns: { type: 'array', items: { type: 'string' }, description: 'Selected numeric columns for wide-to-long conversion or heatmap.' },
        missing: { type: 'string', enum: ['error', 'drop'], required: true, description: 'error rejects incomplete rows; drop excludes them and records the count. Never silently drop.' },
        title: text('Figure title; preserve the scientific meaning.'),
        xLabel: text('Explicit x-axis label including units when provided.'),
        yLabel: text('Explicit y-axis label including units when provided.'),
      }, output,
      execute: async (args, exec) => {
        // Parameter roots are open in Harness. Forward only the reviewed contract;
        // an extra approved/command/path field can never reach the backend.
        const body = {};
        for (const key of ['datasetId', 'chart', 'layout', 'x', 'y', 'group', 'valueColumns', 'missing', 'title', 'xLabel', 'yLabel']) {
          if (args[key] !== undefined) body[key] = args[key];
        }
        const plan = await callApi('/api/plans', { method: 'POST', body, signal: exec.signal });
        return { ...plan, workbenchUrl: workbenchUrl({ planId: plan.id }) };
      },
    }),
    defineTool({
      name: 'bio_run_approved_plan',
      description: 'Run a plotting plan that the user has confirmed in the workbench, and return its results.',
      parameters: { planId: identifier('Plan') }, output,
      execute: async ({ planId }, exec) => {
        const run = await callApi(`/api/plans/${resourceId(planId)}/run`, { method: 'POST', signal: exec.signal });
        return { ...run, workbenchUrl: workbenchUrl({ planId, runId: run.id }) };
      },
    }),
    defineTool({
      name: 'bio_get_run',
      description: 'Get the status, result files, processing details, and workbench link for an analysis run.',
      parameters: { runId: identifier('Run') }, output, isConcurrencySafe: () => true,
      execute: async ({ runId }, exec) => {
        const run = await callApi(`/api/runs/${resourceId(runId)}`, { signal: exec.signal });
        return { ...run, workbenchUrl: workbenchUrl({ planId: run.planId, runId }) };
      },
    }),
  ];
}

export function apply(ctx) {
  for (const tool of createTools()) ctx.tools.register(tool);
}
