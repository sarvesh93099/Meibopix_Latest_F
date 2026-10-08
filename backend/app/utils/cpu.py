"""Choose a native thread budget within the process's available CPU allocation."""

import math
import os
from pathlib import Path


def available_cpu_count():
    count = (getattr(os, 'process_cpu_count', os.cpu_count)() or 1)
    if hasattr(os, 'sched_getaffinity'):
        try:
            count = min(count, len(os.sched_getaffinity(0)))
        except OSError:
            pass
    # Containers may see the host CPU count while having a smaller CPU quota.
    try:
        quota, period = Path('/sys/fs/cgroup/cpu.max').read_text().split()
        if quota != 'max':
            count = min(count, math.ceil(int(quota) / int(period)))
    except (OSError, ValueError, ZeroDivisionError):
        try:
            quota = int(Path('/sys/fs/cgroup/cpu/cpu.cfs_quota_us').read_text())
            period = int(Path('/sys/fs/cgroup/cpu/cpu.cfs_period_us').read_text())
            if quota > 0:
                count = min(count, math.ceil(quota / period))
        except (OSError, ValueError, ZeroDivisionError):
            pass
    return max(1, count)


def inference_thread_count(requested=0, *, cuda=False):
    if requested > 0:
        return requested
    return min(2 if cuda else 6, available_cpu_count())
