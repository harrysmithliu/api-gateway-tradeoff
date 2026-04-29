import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, SmallInteger, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ActivePolicy(Base):
    __tablename__ = "active_policy"

    __table_args__ = (
        CheckConstraint("id = 1", name="single_row_id"),
    )

    id: Mapped[int] = mapped_column(
        SmallInteger,
        primary_key=True,
        nullable=False,
        server_default=text("1"),
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("rate_limit_policies.id", ondelete="RESTRICT"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
