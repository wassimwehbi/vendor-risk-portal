"""Claude Code agent module for executing prompts programmatically.

The agent runner shells out to the `claude` CLI; authentication is via the user's
subscription (interactive login locally, CLAUDE_CODE_OAUTH_TOKEN in CI) or an
ANTHROPIC_API_KEY fallback — handled by the inherited subprocess environment.
"""

import subprocess
import os
import json
import re
import time
from typing import Optional, List, Dict, Any, Tuple, Final
from dotenv import load_dotenv

from adw_modules.data_types import (
    AgentPromptRequest,
    AgentPromptResponse,
    AgentTemplateRequest,
    SlashCommand,
    ModelSet,
    RetryCode,
)

# Load environment variables (.env in repo root if present)
load_dotenv()

# Claude Code CLI path (overridable for non-standard installs).
CLAUDE_PATH = os.getenv("CLAUDE_CODE_PATH", "claude")

# Model selection per slash command, for the "base" and "heavy" model sets.
SLASH_COMMAND_MODEL_MAP: Final[Dict[SlashCommand, Dict[ModelSet, str]]] = {
    "/classify_issue": {"base": "sonnet", "heavy": "sonnet"},
    "/classify_adw": {"base": "sonnet", "heavy": "sonnet"},
    "/generate_branch_name": {"base": "sonnet", "heavy": "sonnet"},
    "/implement": {"base": "sonnet", "heavy": "opus"},
    "/test": {"base": "sonnet", "heavy": "sonnet"},
    "/resolve_failed_test": {"base": "sonnet", "heavy": "opus"},
    "/test_e2e": {"base": "sonnet", "heavy": "sonnet"},
    "/resolve_failed_e2e_test": {"base": "sonnet", "heavy": "opus"},
    "/review": {"base": "sonnet", "heavy": "sonnet"},
    "/document": {"base": "sonnet", "heavy": "opus"},
    "/commit": {"base": "sonnet", "heavy": "sonnet"},
    "/pull_request": {"base": "sonnet", "heavy": "sonnet"},
    "/chore": {"base": "sonnet", "heavy": "opus"},
    "/bug": {"base": "sonnet", "heavy": "opus"},
    "/feature": {"base": "sonnet", "heavy": "opus"},
    "/patch": {"base": "sonnet", "heavy": "opus"},
    "/resolve_copilot_feedback": {"base": "sonnet", "heavy": "opus"},
    "/resolve_conflicts": {"base": "sonnet", "heavy": "opus"},
    "/install_worktree": {"base": "sonnet", "heavy": "sonnet"},
    "/track_agentic_kpis": {"base": "sonnet", "heavy": "sonnet"},
    # UX validation: deterministic runner stays sonnet; visual judgment + fixes lean heavy→opus.
    "/test_ux": {"base": "sonnet", "heavy": "sonnet"},
    "/resolve_failed_ux_test": {"base": "sonnet", "heavy": "opus"},
    "/ux_validate": {"base": "sonnet", "heavy": "opus"},
}


def get_model_for_slash_command(
    request: AgentTemplateRequest, default: str = "sonnet"
) -> str:
    """Return the model for a template request based on ADW state + slash command."""
    from adw_modules.state import ADWState  # local import to avoid a cycle

    model_set: ModelSet = "base"
    state = ADWState.load(request.adw_id)
    if state:
        model_set = state.get("model_set", "base")

    command_config = SLASH_COMMAND_MODEL_MAP.get(request.slash_command)
    if command_config:
        return command_config.get(model_set, command_config.get("base", default))

    return default


def truncate_output(
    output: str, max_length: int = 500, suffix: str = "... (truncated)"
) -> str:
    """Truncate output for display, with special handling for JSONL blobs."""
    if output.startswith('{"type":') and '\n{"type":' in output:
        lines = output.strip().split("\n")
        for line in reversed(lines):
            try:
                data = json.loads(line)
                if data.get("type") == "result":
                    result = data.get("result", "")
                    if result:
                        return truncate_output(result, max_length, suffix)
                elif data.get("type") == "assistant" and data.get("message"):
                    content = data["message"].get("content", [])
                    if isinstance(content, list) and content:
                        text = content[0].get("text", "")
                        if text:
                            return truncate_output(text, max_length, suffix)
            except Exception:
                pass
        return f"[JSONL output with {len(lines)} messages]{suffix}"

    if len(output) <= max_length:
        return output

    truncate_at = max_length - len(suffix)
    newline_pos = output.rfind("\n", truncate_at - 50, truncate_at)
    if newline_pos > 0:
        return output[:newline_pos] + suffix
    space_pos = output.rfind(" ", truncate_at - 20, truncate_at)
    if space_pos > 0:
        return output[:space_pos] + suffix
    return output[:truncate_at] + suffix


def _adw_settings_path(working_dir: Optional[str]) -> Optional[str]:
    """Locate the ADW-scoped settings file (adws/adw_settings.json).

    Passed to `claude --settings` so ADW hooks/permissions apply only to
    ADW-spawned sessions, never to interactive sessions in this repo.
    """
    candidates = []
    if working_dir:
        candidates.append(os.path.join(working_dir, "adws", "adw_settings.json"))
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    candidates.append(os.path.join(repo_root, "adws", "adw_settings.json"))
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


def check_claude_installed() -> Optional[str]:
    """Check whether the Claude Code CLI is installed; return an error if not."""
    try:
        result = subprocess.run(
            [CLAUDE_PATH, "--version"], capture_output=True, text=True
        )
        if result.returncode != 0:
            return f"Error: Claude Code CLI is not installed. Expected at: {CLAUDE_PATH}"
    except FileNotFoundError:
        return f"Error: Claude Code CLI is not installed. Expected at: {CLAUDE_PATH}"
    return None


def parse_jsonl_output(
    output_file: str,
) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Parse a stream-json output file; return (all_messages, result_message)."""
    try:
        with open(output_file, "r") as f:
            messages = [json.loads(line) for line in f if line.strip()]

            result_message = None
            for message in reversed(messages):
                if message.get("type") == "result":
                    result_message = message
                    break

            return messages, result_message
    except Exception:
        return [], None


def convert_jsonl_to_json(jsonl_file: str) -> str:
    """Write a sibling .json array file from a .jsonl file; return its path."""
    json_file = jsonl_file.replace(".jsonl", ".json")
    messages, _ = parse_jsonl_output(jsonl_file)
    with open(json_file, "w") as f:
        json.dump(messages, f, indent=2)
    return json_file


def get_claude_env() -> Dict[str, str]:
    """Return the filtered environment for Claude Code execution."""
    from adw_modules.utils import get_safe_subprocess_env

    return get_safe_subprocess_env()


def save_prompt(prompt: str, adw_id: str, agent_name: str = "ops") -> None:
    """Save a prompt under agents/{adw_id}/{agent_name}/prompts/{command}.txt."""
    match = re.match(r"^(/\w+)", prompt)
    if not match:
        return

    command_name = match.group(1)[1:]  # strip leading slash

    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    prompt_dir = os.path.join(project_root, "agents", adw_id, agent_name, "prompts")
    os.makedirs(prompt_dir, exist_ok=True)

    prompt_file = os.path.join(prompt_dir, f"{command_name}.txt")
    with open(prompt_file, "w") as f:
        f.write(prompt)


def prompt_claude_code_with_retry(
    request: AgentPromptRequest,
    max_retries: int = 3,
    retry_delays: List[int] = None,
) -> AgentPromptResponse:
    """Execute Claude Code with retry logic for transient error types."""
    if retry_delays is None:
        retry_delays = [1, 3, 5]

    while len(retry_delays) < max_retries:
        retry_delays.append(retry_delays[-1] + 2)

    last_response = None

    for attempt in range(max_retries + 1):
        if attempt > 0:
            time.sleep(retry_delays[attempt - 1])

        response = prompt_claude_code(request)
        last_response = response

        if response.success or response.retry_code == RetryCode.NONE:
            return response

        if response.retry_code in [
            RetryCode.CLAUDE_CODE_ERROR,
            RetryCode.TIMEOUT_ERROR,
            RetryCode.EXECUTION_ERROR,
            RetryCode.ERROR_DURING_EXECUTION,
        ]:
            if attempt < max_retries:
                continue
            return response

    return last_response


def prompt_claude_code(request: AgentPromptRequest) -> AgentPromptResponse:
    """Execute Claude Code with the given prompt configuration."""
    error_msg = check_claude_installed()
    if error_msg:
        return AgentPromptResponse(
            output=error_msg,
            success=False,
            session_id=None,
            retry_code=RetryCode.NONE,
        )

    save_prompt(request.prompt, request.adw_id, request.agent_name)

    output_dir = os.path.dirname(request.output_file)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    # Build command - always stream-json + verbose.
    cmd = [CLAUDE_PATH, "-p", request.prompt]
    cmd.extend(["--model", request.model])
    cmd.extend(["--output-format", "stream-json"])
    cmd.append("--verbose")

    # Pick up a per-worktree MCP config if present (e.g. chrome-devtools for review).
    if request.working_dir:
        mcp_config_path = os.path.join(request.working_dir, ".mcp.json")
        if os.path.exists(mcp_config_path):
            cmd.extend(["--mcp-config", mcp_config_path])

    # Apply ADW-scoped settings (safety hooks) without touching interactive sessions.
    settings_path = _adw_settings_path(request.working_dir)
    if settings_path:
        cmd.extend(["--settings", settings_path])

    if request.dangerously_skip_permissions:
        cmd.append("--dangerously-skip-permissions")

    env = get_claude_env()

    try:
        with open(request.output_file, "w") as output_f:
            result = subprocess.run(
                cmd,
                stdout=output_f,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
                cwd=request.working_dir,
            )

        if result.returncode == 0:
            messages, result_message = parse_jsonl_output(request.output_file)
            convert_jsonl_to_json(request.output_file)

            if result_message:
                session_id = result_message.get("session_id")
                is_error = result_message.get("is_error", False)
                subtype = result_message.get("subtype", "")

                if subtype == "error_during_execution":
                    return AgentPromptResponse(
                        output="Error during execution: Agent encountered an error and did not return a result",
                        success=False,
                        session_id=session_id,
                        retry_code=RetryCode.ERROR_DURING_EXECUTION,
                    )

                result_text = result_message.get("result", "")
                if is_error and len(result_text) > 1000:
                    result_text = truncate_output(result_text, max_length=800)

                return AgentPromptResponse(
                    output=result_text,
                    success=not is_error,
                    session_id=session_id,
                    retry_code=RetryCode.NONE,
                )

            error_msg = "No result message found in Claude Code output"
            try:
                with open(request.output_file, "r") as f:
                    lines = f.readlines()
                    last_lines = lines[-5:] if len(lines) > 5 else lines
                    for line in reversed(last_lines):
                        try:
                            data = json.loads(line.strip())
                            if data.get("type") == "assistant" and data.get("message"):
                                content = data["message"].get("content", [])
                                if isinstance(content, list) and content:
                                    text = content[0].get("text", "")
                                    if text:
                                        error_msg = f"Claude Code output: {text[:500]}"
                                        break
                        except Exception:
                            pass
            except Exception:
                pass

            return AgentPromptResponse(
                output=truncate_output(error_msg, max_length=800),
                success=False,
                session_id=None,
                retry_code=RetryCode.NONE,
            )

        # Non-zero exit
        stderr_msg = result.stderr.strip() if result.stderr else ""
        stdout_msg = ""
        error_from_jsonl = None
        try:
            if os.path.exists(request.output_file):
                messages, result_message = parse_jsonl_output(request.output_file)
                if result_message and result_message.get("is_error"):
                    error_from_jsonl = result_message.get("result", "Unknown error")
                elif messages:
                    for msg in reversed(messages[-5:]):
                        if msg.get("type") == "assistant" and msg.get("message", {}).get(
                            "content"
                        ):
                            content = msg["message"]["content"]
                            if isinstance(content, list) and content:
                                text = content[0].get("text", "")
                                if text and (
                                    "error" in text.lower() or "failed" in text.lower()
                                ):
                                    error_from_jsonl = text[:500]
                                    break
                if not error_from_jsonl:
                    with open(request.output_file, "r") as f:
                        lines = f.readlines()
                        if lines:
                            stdout_msg = lines[-1].strip()[:200]
        except Exception:
            pass

        if error_from_jsonl:
            error_msg = f"Claude Code error: {error_from_jsonl}"
        elif stdout_msg and not stderr_msg:
            error_msg = f"Claude Code error: {stdout_msg}"
        elif stderr_msg and not stdout_msg:
            error_msg = f"Claude Code error: {stderr_msg}"
        elif stdout_msg and stderr_msg:
            error_msg = f"Claude Code error: {stderr_msg}\nStdout: {stdout_msg}"
        else:
            error_msg = (
                f"Claude Code error: Command failed with exit code {result.returncode}"
            )

        return AgentPromptResponse(
            output=truncate_output(error_msg, max_length=800),
            success=False,
            session_id=None,
            retry_code=RetryCode.CLAUDE_CODE_ERROR,
        )

    except subprocess.TimeoutExpired:
        return AgentPromptResponse(
            output="Error: Claude Code command timed out",
            success=False,
            session_id=None,
            retry_code=RetryCode.TIMEOUT_ERROR,
        )
    except Exception as e:
        return AgentPromptResponse(
            output=f"Error executing Claude Code: {e}",
            success=False,
            session_id=None,
            retry_code=RetryCode.EXECUTION_ERROR,
        )


def execute_template(request: AgentTemplateRequest) -> AgentPromptResponse:
    """Execute a Claude Code slash-command template with model auto-selection."""
    mapped_model = get_model_for_slash_command(request)
    request = request.model_copy(update={"model": mapped_model})

    prompt = f"{request.slash_command} {' '.join(request.args)}"

    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    output_dir = os.path.join(project_root, "agents", request.adw_id, request.agent_name)
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, "raw_output.jsonl")

    prompt_request = AgentPromptRequest(
        prompt=prompt,
        adw_id=request.adw_id,
        agent_name=request.agent_name,
        model=request.model,
        dangerously_skip_permissions=True,
        output_file=output_file,
        working_dir=request.working_dir,
    )

    return prompt_claude_code_with_retry(prompt_request)
