use std::collections::VecDeque;

/// JavaScript 작업의 논리적 우선순위입니다. OS 스레드 우선순위와는 별개입니다.
/// 사용자 반응성에 따라 작업 실행 순서를 정하도록 웹의 세 우선순위 범주를 참고했습니다.
/// 범주의 의미와 우선순위는 [Prioritized Task Scheduling 명세](https://wicg.github.io/scheduling-apis/#task-and-continuation-priorities),
/// 큐 구조는 [Chromium SequenceManager 문서](https://chromium.googlesource.com/chromium/src/+/main/base/task/sequence_manager/README.md)를 참고하세요.
/// 스피논의 구체적인 선택 규칙은 [내부 스케줄러 명세](https://github.com/ohah/spinon/blob/main/spec/internal/0006-js-task-scheduler.md)에 있습니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskPriority {
    UserBlocking,
    UserVisible,
    Background,
}

impl TaskPriority {
    const fn index(self) -> usize {
        match self {
            Self::UserBlocking => 0,
            Self::UserVisible => 1,
            Self::Background => 2,
        }
    }
}

/// 세 우선순위 큐에서 높은 등급부터 FIFO로 작업을 선택합니다.
///
/// 기아 방지나 실행 중 작업의 선점은 제공하지 않습니다.
#[derive(Debug)]
pub struct PriorityQueue<T> {
    queues: [VecDeque<T>; 3],
    len: usize,
}

impl<T> Default for PriorityQueue<T> {
    fn default() -> Self {
        Self {
            queues: std::array::from_fn(|_| VecDeque::new()),
            len: 0,
        }
    }
}

impl<T> PriorityQueue<T> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, priority: TaskPriority, task: T) {
        self.queues[priority.index()].push_back(task);
        self.len += 1;
    }

    pub fn pop_next(&mut self) -> Option<T> {
        for queue in &mut self.queues {
            if let Some(task) = queue.pop_front() {
                self.len -= 1;
                return Some(task);
            }
        }
        None
    }

    pub const fn len(&self) -> usize {
        self.len
    }

    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }
}

#[cfg(test)]
mod tests {
    use super::{PriorityQueue, TaskPriority};

    #[test]
    fn selects_highest_priority_and_preserves_fifo_within_each_priority() {
        let mut queue = PriorityQueue::new();
        queue.push(TaskPriority::Background, "background-1");
        queue.push(TaskPriority::UserVisible, "visible-1");
        queue.push(TaskPriority::Background, "background-2");
        queue.push(TaskPriority::UserBlocking, "blocking-1");
        queue.push(TaskPriority::UserBlocking, "blocking-2");
        queue.push(TaskPriority::UserVisible, "visible-2");

        assert_eq!(queue.pop_next(), Some("blocking-1"));
        assert_eq!(queue.pop_next(), Some("blocking-2"));
        assert_eq!(queue.pop_next(), Some("visible-1"));
        assert_eq!(queue.pop_next(), Some("visible-2"));
        assert_eq!(queue.pop_next(), Some("background-1"));
        assert_eq!(queue.pop_next(), Some("background-2"));
        assert!(queue.is_empty());
    }
}
