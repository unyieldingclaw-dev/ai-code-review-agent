# PreToolUse now peeks; native Git hooks alone consume review authorization.
# A post hook cannot prove whether a native hook spent a marker before a failed
# command, so never recreate it from legacy pending state or a changed tree.
exit 0
