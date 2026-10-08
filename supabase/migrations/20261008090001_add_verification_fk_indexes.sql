create index if not exists agent_test_runs_actor_id_idx on public.agent_test_runs(actor_id);
create index if not exists agent_test_runs_agent_id_idx on public.agent_test_runs(agent_id);
create index if not exists knowledge_documents_verified_by_idx on public.knowledge_documents(verified_by);
