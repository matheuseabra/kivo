import { addProviderApiKeyHeader } from "@/store/utils/providerCredentials";

interface CurrentValue<T> {
  current: T;
}

export function createChatPanelFetch(
  workflowState: CurrentValue<unknown>,
  selectedNodeIds: CurrentValue<string[] | undefined>,
  fetcher: typeof fetch = fetch
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined
    );
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    const requestInit = {
      ...init,
      headers: addProviderApiKeyHeader("gemini", headers),
    };
    if (!init?.body) return fetcher(input, requestInit);

    const body = JSON.parse(init.body as string);
    return fetcher(input, {
      ...requestInit,
      body: JSON.stringify({
        ...body,
        workflowState: workflowState.current,
        selectedNodeIds: selectedNodeIds.current,
      }),
    });
  };
}
