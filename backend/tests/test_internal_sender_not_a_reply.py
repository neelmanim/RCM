from email_utils import internal_domains, is_internal_sender
from tests.conftest import create_test_user
import models


def test_colleague_mail_is_internal_but_a_customer_is_not(db):
    u = create_test_user(db, email="rep@screen-magic.com", role="SDR")
    u2 = create_test_user(db, email="rep2@screen-magic.com", role="SDR")
    g = create_test_user(db, email="rep3@gmail.com", role="SDR")
    g2 = create_test_user(db, email="rep4@gmail.com", role="SDR")
    for x in (u, u2, g, g2):
        db.add(models.UserMailbox(user_id=x.id, email_address=x.email, status="connected", nylas_grant_id="g" + x.id))
    db.commit()
    d = internal_domains(db)
    assert is_internal_sender("priyanka.purohit@screen-magic.com", d)
    assert not is_internal_sender("buyer@lupin.com", d)
    assert not is_internal_sender("", d)
    assert not is_internal_sender("lead@gmail.com", d)   # reps on Gmail do not make every Gmail lead internal
