from crm.customers.register import register


def test_email_is_normalized() -> None:
    assert register("c1", " Ada@Example.com ").email == "ada@example.com"
