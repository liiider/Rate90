"""Forward a private Unix socket to the official OpenAI TLS endpoint."""
import asyncio
import os
from pathlib import Path


async def copy_stream(reader, writer):
    while chunk := await reader.read(65536):
        writer.write(chunk)
        await writer.drain()
    if writer.can_write_eof():
        writer.write_eof()


async def forward(reader, writer):
    peer = None
    tasks = []
    try:
        upstream, peer = await asyncio.wait_for(
            asyncio.open_connection("api.openai.com", 443, happy_eyeballs_delay=.25), 15)
        tasks = [asyncio.create_task(copy_stream(reader, peer)),
                 asyncio.create_task(copy_stream(upstream, writer))]
        await asyncio.wait_for(asyncio.gather(*tasks), 120)
    except (OSError, asyncio.TimeoutError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        writer.close()
        if peer:
            peer.close()


async def main():
    os.umask(0o077)
    path = Path("/run/rate90/openai.sock")
    path.unlink(missing_ok=True)
    async with await asyncio.start_unix_server(forward, path=str(path)) as server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
