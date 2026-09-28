from crm.invoices.issue import issue_invoice


def test_issue_invoice_marks_it_issued():
    assert issue_invoice("c1", 1200)["status"] == "issued"
