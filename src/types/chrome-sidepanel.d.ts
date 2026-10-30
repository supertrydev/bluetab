declare namespace chrome {
  namespace sidePanel {
    function open(options: { windowId?: number; tabId?: number }): Promise<void>;
  }
}
