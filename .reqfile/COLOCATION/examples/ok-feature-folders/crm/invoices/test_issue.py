from crm.invoices.issue import issue


def test_total_is_the_sum_of_lines() -> None:
    assert issue("i1", "c1", [100, 250]).total_cents == 350
