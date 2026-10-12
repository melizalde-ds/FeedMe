"""A tiny MCP server with the same general tool the Link CLI exposes. Used to test
the MCP connection itself; it never touches Link or Stripe."""

import json

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

server = MCPServer("fake-link")


@server.tool()
def call_write_tool(name: str, arguments: dict) -> str:
    if name == "fail":
        raise ToolError("Not authenticated")
    return json.dumps({"command": name, "echo": arguments})


if __name__ == "__main__":
    server.run()
